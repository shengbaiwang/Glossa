import Foundation
import Security

#if REVISION_TWO
let revision = 2
#else
let revision = 1
#endif

guard CommandLine.arguments.count == 3 else { exit(2) }
let operation = CommandLine.arguments[1]
let service = CommandLine.arguments[2]
guard service.hasPrefix("app.glossa.signing-acceptance.") else { exit(2) }
let account = "dummy-only"
let dummy = Data("Glossa disposable signing acceptance fixture".utf8)
// A test must fail instead of opening an authorization dialog.
let interactionStatus = SecKeychainSetUserInteractionAllowed(false)
guard interactionStatus == errSecSuccess else { exit(3) }
var keychain: SecKeychain?
guard SecKeychainCopyDefault(&keychain) == errSecSuccess, let keychain else { exit(3) }
var status: OSStatus = errSecParam
var matches = false

switch operation {
case "create":
    status = dummy.withUnsafeBytes { bytes in
        SecKeychainAddGenericPassword(keychain, UInt32(service.utf8.count), service, UInt32(account.utf8.count), account, UInt32(dummy.count), bytes.baseAddress!, nil)
    }
case "read":
    var length: UInt32 = 0
    var bytes: UnsafeMutableRawPointer?
    status = SecKeychainFindGenericPassword(keychain, UInt32(service.utf8.count), service, UInt32(account.utf8.count), account, &length, &bytes, nil)
    if status == errSecSuccess, let bytes {
        matches = Data(bytes: bytes, count: Int(length)) == dummy
        SecKeychainItemFreeContent(nil, bytes)
    }
case "status":
    var result: CFTypeRef?
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
        kSecMatchSearchList as String: [keychain],
        kSecMatchLimit as String: kSecMatchLimitOne,
        kSecReturnAttributes as String: true,
        kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail,
    ]
    status = SecItemCopyMatching(query as CFDictionary, &result)
case "delete":
    var item: SecKeychainItem?
    status = SecKeychainFindGenericPassword(keychain, UInt32(service.utf8.count), service, UInt32(account.utf8.count), account, nil, nil, &item)
    if status == errSecSuccess, let item { status = SecKeychainItemDelete(item) }
default:
    exit(2)
}
let report: [String: Any] = ["revision": revision, "operation": operation, "status": status, "valueMatches": matches]
let output = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
print(String(data: output, encoding: .utf8)!)
