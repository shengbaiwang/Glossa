import Foundation
import Security
import Darwin

// Replaced during explicit local provisioning. Never accept a caller-supplied pin.
let certificateSHA1 = "__GLOSSA_SIGNING_CERT_SHA1__"
let maximumInput = 65_536
let fixturePrefix = "glossa-signing-acceptance."

struct Request: Decodable {
    let operation: String
    let account: String
    let valueBase64: String?
    let legacy: Bool?
    let previous: Bool?
    let noninteractive: Bool?
}

func respond(_ response: [String: Any]) -> Never {
    if let bytes = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]) {
        FileHandle.standardOutput.write(bytes)
    }
    exit(0)
}

func fail(_ code: String) -> Never {
    respond(["status": "unavailable", "success": false, "error": code])
}

func parentDetails(_ pid: pid_t) -> proc_bsdinfo? {
    var info = proc_bsdinfo()
    let count = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout<proc_bsdinfo>.size))
    guard count == MemoryLayout<proc_bsdinfo>.size else { return nil }
    return info
}

func hardenedCaller(_ code: SecCode) -> Bool {
    var staticCode: SecStaticCode?
    guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { return false }
    var signing: CFDictionary?
    guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &signing) == errSecSuccess,
          let info = signing as? [String: Any], let flags = info[kSecCodeInfoFlags as String] as? NSNumber,
          flags.uint32Value & 0x10000 != 0 else { return false } // kSecCodeSignatureRuntime in CSCommon.h
    let entitlements = info[kSecCodeInfoEntitlementsDict as String] as? [String: Any] ?? [:]
    for name in ["com.apple.security.cs.allow-dyld-environment-variables",
                 "com.apple.security.cs.disable-library-validation", "com.apple.security.get-task-allow"] {
        if entitlements[name] as? Bool == true { return false }
    }
    return true
}

// The helper grants access to two exact app identities signed by the one local
// certificate. UID alone, bundle name alone, and parent path are never authority.
let parentPID = getppid()
guard parentPID > 1, getuid() == geteuid(),
      let before = parentDetails(parentPID), before.pbi_uid == geteuid() else { fail("caller-not-authorized") }
var parentCode: SecCode?
let parentQuery = [kSecGuestAttributePid as String: parentPID] as CFDictionary
guard SecCodeCopyGuestWithAttributes(nil, parentQuery, [], &parentCode) == errSecSuccess,
      let parentCode else { fail("caller-not-authorized") }
var verifiedIdentifier: String?
for identifier in ["app.glossa.reader", "app.glossa.reader.dev"] {
    var requirement: SecRequirement?
    let rule = "identifier \"\(identifier)\" and certificate leaf = H\"\(certificateSHA1)\""
    guard SecRequirementCreateWithString(rule as CFString, [], &requirement) == errSecSuccess,
          let requirement else { fail("helper-configuration-invalid") }
    if SecCodeCheckValidity(parentCode, SecCSFlags(rawValue: kSecCSStrictValidate), requirement) == errSecSuccess {
        verifiedIdentifier = identifier
        break
    }
}
guard let verifiedIdentifier, hardenedCaller(parentCode), getppid() == parentPID,
      let after = parentDetails(parentPID), after.pbi_uid == before.pbi_uid,
      after.pbi_start_tvsec == before.pbi_start_tvsec,
      after.pbi_start_tvusec == before.pbi_start_tvusec else { fail("caller-not-authorized") }

var input = Data()
while true {
    let chunk = FileHandle.standardInput.readData(ofLength: min(8192, maximumInput + 1 - input.count))
    if chunk.isEmpty { break }
    input.append(chunk)
    if input.count > maximumInput { fail("request-too-large") }
}
let allowedFields: Set<String> = ["operation", "account", "valueBase64", "legacy", "previous", "noninteractive"]
guard let fields = (try? JSONSerialization.jsonObject(with: input)) as? [String: Any],
      Set(fields.keys).isSubset(of: allowedFields),
      let request = try? JSONDecoder().decode(Request.self, from: input),
      !request.account.isEmpty, request.account.utf8.count <= 512,
      !request.account.contains("\0") else { fail("invalid-request") }
let fixture = request.account.hasPrefix(fixturePrefix)
guard request.noninteractive != true || fixture else { fail("invalid-request") }
guard request.legacy != true || verifiedIdentifier == "app.glossa.reader" else { fail("invalid-request") }
guard !(request.legacy == true && request.previous == true) else { fail("invalid-request") }
guard request.legacy != true || request.operation == "get" || request.operation == "status" else { fail("invalid-request") }
guard request.previous != true || request.operation == "get" || request.operation == "status" else { fail("invalid-request") }
guard request.operation == "set" || request.valueBase64 == nil else { fail("invalid-request") }
guard ["get", "set", "status", "deleteFixture"].contains(request.operation) else { fail("invalid-request") }
if request.operation == "deleteFixture" && (!fixture || request.noninteractive != true || request.legacy == true || request.previous == true) {
    fail("invalid-request")
}
if request.operation == "status" || request.noninteractive == true {
    guard SecKeychainSetUserInteractionAllowed(false) == errSecSuccess else { fail("keychain-unavailable") }
}
// Check again after reading stdin so a dead/replaced caller cannot leave an
// orphaned helper retrieving credentials after its authority is gone.
guard getppid() == parentPID, let finalParent = parentDetails(parentPID),
      finalParent.pbi_start_tvsec == before.pbi_start_tvsec,
      finalParent.pbi_start_tvusec == before.pbi_start_tvusec,
      finalParent.pbi_uid == before.pbi_uid else { fail("caller-not-authorized") }
// A process can exec another executable without changing PID/start time. Fetch
// a fresh dynamic code object after stdin, not just the pre-request snapshot.
var finalCode: SecCode?
var finalRequirement: SecRequirement?
let finalRule = "identifier \"\(verifiedIdentifier)\" and certificate leaf = H\"\(certificateSHA1)\""
guard SecCodeCopyGuestWithAttributes(nil, parentQuery, [], &finalCode) == errSecSuccess,
      let finalCode,
      SecRequirementCreateWithString(finalRule as CFString, [], &finalRequirement) == errSecSuccess,
      let finalRequirement,
      SecCodeCheckValidity(finalCode, SecCSFlags(rawValue: kSecCSStrictValidate), finalRequirement) == errSecSuccess,
      hardenedCaller(finalCode) else {
    fail("caller-not-authorized")
}
var keychain: SecKeychain?
guard SecKeychainCopyDefault(&keychain) == errSecSuccess, let keychain else { fail("keychain-unavailable") }
let production = verifiedIdentifier == "app.glossa.reader"
let service = request.legacy == true ? "Readest Safe Storage" : request.previous == true ?
    (production ? "Glossa Safe Storage" : "Glossa Dev Safe Storage") :
    (production ? "Glossa Credentials v2" : "Glossa Dev Credentials v2")
var query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: request.account,
    kSecMatchSearchList as String: [keychain],
]
if request.operation == "status" || request.noninteractive == true {
    query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
}

func respondStatus(_ status: OSStatus) -> Never {
    if status == errSecItemNotFound { respond(["status": "missing", "success": false]) }
    if status != errSecSuccess { fail("keychain-access-failed:\(status)") }
    respond(["status": "present", "success": true])
}

switch request.operation {
case "status":
    query[kSecReturnAttributes as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecSuccess {
        guard let attributes = result as? [String: Any] else { fail("keychain-response-invalid") }
        let cleared = attributes[kSecAttrComment as String] as? String == "glossa-cleared-v1"
        respond(["status": cleared ? "missing" : "present", "success": true, "cleared": cleared])
    }
    respondStatus(status)
case "get":
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecSuccess {
        guard let bytes = result as? Data, bytes.count <= 32_768 else { fail("keychain-response-invalid") }
        respond(["status": "present", "success": true, "dataBase64": bytes.base64EncodedString()])
    }
    respondStatus(status)
case "set":
    guard let encoded = request.valueBase64, let bytes = Data(base64Encoded: encoded),
          !bytes.isEmpty, bytes.count <= 32_768,
          bytes.first == 1 || bytes == Data([0]) else { fail("invalid-record") }
    let changes: [String: Any] = [
        kSecValueData as String: bytes,
        kSecAttrComment as String: bytes == Data([0]) ? "glossa-cleared-v1" : "glossa-saved-v1",
    ]
    var status = SecItemUpdate(query as CFDictionary, changes as CFDictionary)
    if status == errSecItemNotFound {
        var addition = query
        addition.removeValue(forKey: kSecMatchSearchList as String)
        addition[kSecUseKeychain as String] = keychain
        changes.forEach { addition[$0.key] = $0.value }
        status = SecItemAdd(addition as CFDictionary, nil)
    }
    respondStatus(status)
case "deleteFixture":
    respondStatus(SecItemDelete(query as CFDictionary))
default:
    fail("invalid-request")
}
