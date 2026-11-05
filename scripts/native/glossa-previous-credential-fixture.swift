import Foundation
import Security

// An older app's dummy item, never a real account or configurable service.
guard CommandLine.arguments.count == 4,
      ["create", "get", "delete"].contains(CommandLine.arguments[1]),
      ["production", "development"].contains(CommandLine.arguments[2]),
      CommandLine.arguments[3].hasPrefix("glossa-signing-acceptance.") else { exit(2) }
SecKeychainSetUserInteractionAllowed(false)
let operation = CommandLine.arguments[1]
let production = CommandLine.arguments[2] == "production"
let account = CommandLine.arguments[3]
var keychain: SecKeychain?
guard SecKeychainCopyDefault(&keychain) == errSecSuccess, let keychain else { exit(2) }
var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: production ? "Glossa Safe Storage" : "Glossa Dev Safe Storage",
    kSecAttrAccount as String: account, kSecMatchSearchList as String: [keychain],
    kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail]
var result: CFTypeRef?
let status: OSStatus
if operation == "create" {
    query.removeValue(forKey: kSecMatchSearchList as String)
    query[kSecUseKeychain as String] = keychain
    query[kSecValueData as String] = Data([1]) + Data("synthetic-previous-only".utf8)
    status = SecItemAdd(query as CFDictionary, nil)
} else if operation == "get" {
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    status = SecItemCopyMatching(query as CFDictionary, &result)
} else {
    status = SecItemDelete(query as CFDictionary)
}
var response: [String: Any] = ["status": status == errSecSuccess ? "present" : status == errSecItemNotFound ? "missing" : "unavailable", "osStatus": status]
if let data = result as? Data { response["dataBase64"] = data.base64EncodedString() }
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: response))
