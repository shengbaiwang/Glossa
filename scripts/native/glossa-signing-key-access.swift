import Foundation
import Security
import CryptoKit

// Inspect or tighten only the private key paired with one exact certificate in
// the specified user keychain. No secrets or private-key bytes are exported.
func fail(_ message: String) -> Never { fputs("\(message)\n", stderr); exit(1) }
func requireSuccess(_ status: OSStatus, _ operation: String) {
    if status != errSecSuccess { fail("\(operation) failed (OSStatus \(status))") }
}
guard CommandLine.arguments.count == 4 else { fail("Expected inspect|lock, certificate SHA1, and keychain path") }
let operation = CommandLine.arguments[1]
let fingerprint = CommandLine.arguments[2].uppercased()
guard ["inspect", "lock"].contains(operation), fingerprint.count == 40,
      fingerprint.allSatisfy({ $0.isHexDigit }) else { fail("Invalid arguments") }
var keychain: SecKeychain?
requireSuccess(SecKeychainOpen(CommandLine.arguments[3], &keychain), "Open keychain")
guard let keychain else { fail("Missing keychain") }
let query: [String: Any] = [kSecClass as String: kSecClassIdentity,
    kSecMatchSearchList as String: [keychain], kSecMatchLimit as String: kSecMatchLimitAll,
    kSecReturnRef as String: true]
var result: CFTypeRef?
requireSuccess(SecItemCopyMatching(query as CFDictionary, &result), "Find identities")
guard let identities = result as? [SecIdentity] else { fail("Unexpected identity response") }
var matches: [SecIdentity] = []
for identity in identities {
    var certificate: SecCertificate?
    requireSuccess(SecIdentityCopyCertificate(identity, &certificate), "Read public certificate")
    guard let certificate else { continue }
    let digest = Insecure.SHA1.hash(data: SecCertificateCopyData(certificate) as Data)
        .map { String(format: "%02X", $0) }.joined()
    if digest == fingerprint { matches.append(identity) }
}
guard matches.count == 1 else { fail("Expected exactly one matching identity") }
var key: SecKey?
requireSuccess(SecIdentityCopyPrivateKey(matches[0], &key), "Reference private key")
guard let key else { fail("Missing private key") }
// SecKeychainItem APIs accept persistent SecKey objects in the macOS keychain.
let item = unsafeBitCast(key, to: SecKeychainItem.self)
var access: SecAccess?
requireSuccess(SecKeychainItemCopyAccess(item, &access), "Read private-key access")
guard let access else { fail("Missing access object") }
var aclList: CFArray?
requireSuccess(SecAccessCopyACLList(access, &aclList), "Read ACL list")
guard let acls = aclList as? [SecACL] else { fail("Unexpected ACL list") }
let sensitive: Set<String> = [kSecACLAuthorizationAny, kSecACLAuthorizationSign,
    kSecACLAuthorizationDecrypt, kSecACLAuthorizationDerive,
    kSecACLAuthorizationExportClear, kSecACLAuthorizationExportWrapped,
    kSecACLAuthorizationMAC,
    kSecACLAuthorizationChangeACL].map { $0 as String }.reduce(into: []) { $0.insert($1) }
var inspected: [[String: Any]] = []
var changed = 0
for acl in acls {
    let authorizations = SecACLCopyAuthorizations(acl) as! [String]
    // Preserve partition ACLs and non-sensitive entries verbatim; never broaden
    // or replace the item's access object, and never use nil (means trust all).
    if Set(authorizations).isDisjoint(with: sensitive) { continue }
    var applications: CFArray?
    var description: CFString?
    var selector = SecKeychainPromptSelector()
    requireSuccess(SecACLCopyContents(acl, &applications, &description, &selector), "Read restricted ACL")
    let count = applications.map { CFArrayGetCount($0) }
    inspected.append(["authorizations": authorizations, "trustedApplications": count ?? -1])
    if operation == "lock", count != 0 {
        requireSuccess(SecACLSetContents(acl, [] as CFArray,
            description ?? "Glossa Local Code Signing" as CFString, selector), "Tighten restricted ACL")
        changed += 1
    }
}
guard !inspected.isEmpty else { fail("No restricted ACL found; refusing to guess") }
if operation == "lock", changed > 0 {
    requireSuccess(SecKeychainItemSetAccess(item, access), "Save restricted private-key ACL")
}
var verifiedEmpty = inspected.allSatisfy { ($0["trustedApplications"] as? Int) == 0 }
var signingDeniedWithoutUI: Bool?
var signingProbeStatus: Int?
if operation == "lock" {
    var persisted: SecAccess?
    requireSuccess(SecKeychainItemCopyAccess(item, &persisted), "Verify saved private-key access")
    guard let persisted else { fail("Missing saved access") }
    var savedList: CFArray?
    requireSuccess(SecAccessCopyACLList(persisted, &savedList), "Verify saved ACL list")
    guard let savedACLs = savedList as? [SecACL] else { fail("Unexpected saved ACL list") }
    for acl in savedACLs {
        let tags = SecACLCopyAuthorizations(acl) as! [String]
        if Set(tags).isDisjoint(with: sensitive) { continue }
        var applications: CFArray?
        var description: CFString?
        var selector = SecKeychainPromptSelector()
        requireSuccess(SecACLCopyContents(acl, &applications, &description, &selector), "Verify restricted applications")
        guard let applications, CFArrayGetCount(applications) == 0 else { fail("Restricted private-key access is still trusted") }
    }
    verifiedEmpty = true
    requireSuccess(SecKeychainSetUserInteractionAllowed(false), "Disable probe interaction")
    guard SecKeyIsAlgorithmSupported(key, .sign, .rsaSignatureMessagePKCS1v15SHA256) else {
        fail("Signing probe algorithm is unsupported")
    }
    var error: Unmanaged<CFError>?
    let signature = SecKeyCreateSignature(key, .rsaSignatureMessagePKCS1v15SHA256,
        Data("Glossa private-key noninteractive rejection probe".utf8) as CFData, &error)
    guard signature == nil else { fail("Private key unexpectedly allowed signing without authorization") }
    guard let failure = error?.takeRetainedValue() else { fail("Signing probe failed without an authorization error") }
    let code = CFErrorGetCode(failure)
    guard [Int(errSecInteractionNotAllowed), Int(errSecAuthFailed)].contains(code) else {
        fail("Signing probe failed for an unexpected reason (OSStatus \(code))")
    }
    signingDeniedWithoutUI = true
    signingProbeStatus = code
}
var output: [String: Any] = ["certificateSHA1": fingerprint, "operation": operation,
    "restrictedACLsBefore": inspected, "tightenedEntries": changed, "verifiedEmpty": verifiedEmpty]
if let signingDeniedWithoutUI { output["signingDeniedWithoutUI"] = signingDeniedWithoutUI }
if let signingProbeStatus { output["signingProbeStatus"] = signingProbeStatus }
let encoded = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
FileHandle.standardOutput.write(encoded)
