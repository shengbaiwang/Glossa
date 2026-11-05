import Foundation
import Security

#if REVISION_TWO
let revision = 2
#else
let revision = 1
#endif
let certificateSHA1 = "__GLOSSA_SIGNING_CERT_SHA1__"
guard CommandLine.arguments.count == 2 else { exit(2) }
let request = FileHandle.standardInput.readDataToEndOfFile()
// A signed acceptance caller must never become a general credential proxy if
// someone later executes the fixture directly from the ignored QA directory.
guard let fields = (try? JSONSerialization.jsonObject(with: request)) as? [String: Any],
      let account = fields["account"] as? String,
      account.hasPrefix("glossa-signing-acceptance.") else { exit(2) }
let process = Process()
let input = Pipe()
let output = Pipe()
process.executableURL = URL(fileURLWithPath: CommandLine.arguments[1])
process.standardInput = input
process.standardOutput = output
process.standardError = FileHandle.nullDevice
try process.run()
// Mirror the app-side security boundary: verify the running process before any
// credential payload enters its stdin, not merely a file before launching it.
var code: SecCode?
var requirement: SecRequirement?
let rule = "identifier \"app.glossa.credential-helper\" and certificate leaf = H\"\(certificateSHA1)\""
let requirementStatus = SecRequirementCreateWithString(rule as CFString, [], &requirement)
let lookup = SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributePid as String: process.processIdentifier] as CFDictionary, [], &code)
if requirementStatus != errSecSuccess || lookup != errSecSuccess || code == nil || requirement == nil || SecCodeCheckValidity(code!, SecCSFlags(rawValue: kSecCSStrictValidate), requirement!) != errSecSuccess {
    process.terminate()
    input.fileHandleForWriting.closeFile()
    print("{\"status\":\"unavailable\",\"error\":\"helper-process-not-authorized\"}")
    exit(0)
}
input.fileHandleForWriting.write(request)
input.fileHandleForWriting.closeFile()
let response = output.fileHandleForReading.readDataToEndOfFile()
process.waitUntilExit()
guard var object = (try? JSONSerialization.jsonObject(with: response)) as? [String: Any] else {
    print("{\"status\":\"unavailable\",\"error\":\"helper-response-invalid\"}")
    exit(0)
}
object["callerRevision"] = revision
let result = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
print(String(data: result, encoding: .utf8)!)
