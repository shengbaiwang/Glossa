import Foundation
import Security

// Provisioning only: import one new Glossa code-signing key. The temporary
// archive passphrase arrives on stdin, never in argv, files, or diagnostic text.
func requireSuccess(_ status: OSStatus, _ operation: String) {
    guard status == errSecSuccess else {
        fputs("\(operation) failed (OSStatus \(status))\n", stderr)
        exit(1)
    }
}

guard CommandLine.arguments.count == 3, let passphrase = readLine(), !passphrase.isEmpty else {
    fputs("Expected PKCS12 path, user keychain path, and passphrase on stdin\n", stderr)
    exit(1)
}

var keychain: SecKeychain?
requireSuccess(SecKeychainOpen(CommandLine.arguments[2], &keychain), "Open user keychain")
var access: SecAccess?
// Empty (not nil) means no trusted apps. Permanently trusting codesign would let
// any process owned by this user mint a caller accepted by the credential helper.
requireSuccess(SecAccessCreate("Glossa Local Code Signing" as CFString, [] as CFArray, &access), "Create signing-key access")
do {
    let archive = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
    var items: CFArray?
    let options: [String: Any] = [
        kSecImportExportPassphrase as String: passphrase,
        kSecImportExportKeychain as String: keychain!,
        kSecImportExportAccess as String: access!,
    ]
    requireSuccess(SecPKCS12Import(archive as CFData, options as CFDictionary, &items), "Import signing identity")
    print("Imported one signing identity requiring explicit private-key authorization")
} catch {
    fputs("Unable to read the temporary signing archive\n", stderr)
    exit(1)
}
