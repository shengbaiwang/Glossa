// Test-only Quartz input for the isolated WebDriver executable. No application IPC or secrets.
import AppKit
import ApplicationServices
import Foundation

enum InputError: Error { case invalid(String) }

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value
}

func rectangle(_ element: AXUIElement) -> CGRect? {
    guard let position = attribute(element, kAXPositionAttribute),
          let size = attribute(element, kAXSizeAttribute),
          CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID()
    else { return nil }
    var point = CGPoint.zero
    var dimensions = CGSize.zero
    guard AXValueGetValue(position as! AXValue, .cgPoint, &point),
          AXValueGetValue(size as! AXValue, .cgSize, &dimensions)
    else { return nil }
    return CGRect(origin: point, size: dimensions)
}

func jsonRect(_ rect: CGRect) -> [String: Double] {
    ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height]
}

func sameFile(_ first: String, _ second: String) -> Bool {
    guard let a = try? FileManager.default.attributesOfItem(atPath: first),
          let b = try? FileManager.default.attributesOfItem(atPath: second),
          let aDevice = a[.systemNumber] as? NSNumber, let bDevice = b[.systemNumber] as? NSNumber,
          let aFile = a[.systemFileNumber] as? NSNumber, let bFile = b[.systemFileNumber] as? NSNumber
    else { return false }
    return aDevice == bDevice && aFile == bFile
}

func foregroundPid() -> pid_t? {
    let system = AXUIElementCreateSystemWide()
    AXUIElementSetMessagingTimeout(system, 1)
    guard let focused = attribute(system, kAXFocusedApplicationAttribute),
          CFGetTypeID(focused) == AXUIElementGetTypeID() else { return nil }
    var pid: pid_t = 0
    guard AXUIElementGetPid(focused as! AXUIElement, &pid) == .success else { return nil }
    return pid
}

final class NativeInput {
    var targetPid: pid_t?
    var targetPath: String?
    var targetLaunch: Date?
    var position = CGEvent(source: nil)?.location ?? .zero
    var heldKeys: [String: CGKeyCode] = [:]
    var heldButtons: Set<Int> = []
    var flags: CGEventFlags = []
    var lastClickPosition = CGPoint.zero
    var lastClickTime: TimeInterval = 0
    var lastClickButton = -1
    var clickCount = 0
    var activated = false
    let source = CGEventSource(stateID: .hidSystemState)
    let clipboard = NSPasteboard.general
    var originalClipboard: [[NSPasteboard.PasteboardType: Data]]?
    var ownedClipboardChange: Int?

    func target(_ request: [String: Any]) throws -> NSRunningApplication {
        guard let number = request["targetPid"] as? Int, number > 0,
              let path = request["expectedExecutable"] as? String,
              ["/target/debug/glossa", "/target/debug/Glossa"].contains(where: { path.hasSuffix($0) }), !path.contains("/.glossa-dev/"),
              let application = NSRunningApplication(processIdentifier: pid_t(number)),
              let runningPath = application.executableURL?.path, sameFile(runningPath, path), !application.isTerminated
        else { throw InputError.invalid("Only the exact isolated WebDriver executable is allowed") }
        if let targetPid {
            guard targetPid == pid_t(number), targetPath == path, targetLaunch == application.launchDate
            else { throw InputError.invalid("Test target identity changed") }
        } else {
            targetPid = pid_t(number)
            targetPath = path
            targetLaunch = application.launchDate
        }
        return application
    }

    func window(_ app: NSRunningApplication) throws -> AXUIElement {
        let root = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(root, 1)
        if let focused = attribute(root, kAXFocusedWindowAttribute),
           CFGetTypeID(focused) == AXUIElementGetTypeID() { return focused as! AXUIElement }
        if let windows = attribute(root, kAXWindowsAttribute) as? [AXUIElement],
           let window = windows.first { return window }
        throw InputError.invalid("The isolated native window has no accessible bounds")
    }

    func geometry(_ app: NSRunningApplication) throws -> CGRect {
        guard let rect = rectangle(try window(app)) else {
            throw InputError.invalid("The isolated native window has no accessible bounds")
        }
        return rect
    }

    func geometryInfo(_ app: NSRunningApplication) throws -> [String: Any] {
        try foreground(app)
        let element = try window(app)
        guard let bounds = rectangle(element),
              let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement],
              let content = children.compactMap({ child -> CGRect? in
                  guard attribute(child, kAXRoleAttribute) as? String == kAXGroupRole,
                        let rect = rectangle(child), rect.width > 100, rect.height > 100,
                        bounds.insetBy(dx: -1, dy: -1).contains(rect) else { return nil }
                  return rect
              }).max(by: { $0.width * $0.height < $1.width * $1.height }) else {
            throw InputError.invalid("The isolated native content view has no accessible bounds")
        }
        return ["windowBounds": jsonRect(bounds), "contentBounds": jsonRect(content)]
    }

    func foreground(_ app: NSRunningApplication) throws {
        guard AXIsProcessTrusted(), CGPreflightPostEventAccess() else {
            throw InputError.invalid("Native input requires existing Accessibility permission")
        }
        if !activated && foregroundPid() != app.processIdentifier {
            app.unhide()
            let root = AXUIElementCreateApplication(app.processIdentifier)
            AXUIElementSetAttributeValue(root, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
            if let windows = attribute(root, kAXWindowsAttribute) as? [AXUIElement],
               let window = windows.first { AXUIElementPerformAction(window, kAXRaiseAction as CFString) }
            app.activate(options: [.activateAllWindows])
            for _ in 0..<75 {
                if foregroundPid() == app.processIdentifier { break }
                usleep(20_000)
            }
        }
        guard foregroundPid() == app.processIdentifier else {
            throw InputError.invalid("Native input stopped: the isolated test app does not have foreground focus")
        }
        activated = true
    }

    func post(_ event: CGEvent, _ app: NSRunningApplication) throws {
        guard foregroundPid() == app.processIdentifier else {
            throw InputError.invalid("Native input stopped because the test app lost foreground focus")
        }
        event.flags = flags
        event.post(tap: .cghidEventTap)
        usleep(12_000)
    }

    func modifier(_ key: String) -> (CGKeyCode, CGEventFlags)? {
        switch key {
        case "\u{e008}": return (56, .maskShift)
        case "\u{e009}": return (59, .maskControl)
        case "\u{e00a}": return (58, .maskAlternate)
        case "\u{e03d}": return (55, .maskCommand)
        default: return nil
        }
    }

    func keyCode(_ key: String) throws -> CGKeyCode {
        if let modifier = modifier(key) { return modifier.0 }
        let codes: [String: CGKeyCode] = [
            "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7,
            "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15,
            "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22,
            "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29,
            "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "l": 37,
            "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44,
            "n": 45, "m": 46, ".": 47, "`": 50, " ": 49,
            "\u{e003}": 51, "\u{e004}": 48, "\u{e006}": 36, "\u{e007}": 36,
            "\u{e00c}": 53, "\u{e00d}": 49, "\u{e012}": 123, "\u{e013}": 126,
            "\u{e014}": 124, "\u{e015}": 125, "\u{e017}": 117,
        ]
        if let code = codes[key.lowercased()] { return code }
        guard key.unicodeScalars.allSatisfy({ $0.value < 0xe000 || $0.value > 0xf8ff }) else {
            throw InputError.invalid("Unsupported WebDriver private-use key")
        }
        return 0 // Unicode text event; no keyboard-layout guessing for composed text.
    }

    func rememberClipboard() {
        if originalClipboard != nil && ownedClipboardChange == clipboard.changeCount { return }
        // An external copy between test actions becomes the new recovery baseline.
        // Keep these bytes in memory only; never print or persist clipboard content.
        originalClipboard = (clipboard.pasteboardItems ?? []).map { item in
            var values: [NSPasteboard.PasteboardType: Data] = [:]
            for type in item.types { if let data = item.data(forType: type) { values[type] = data } }
            return values
        }
        ownedClipboardChange = nil
    }

    @discardableResult func restoreClipboard() -> Bool {
        guard let saved = originalClipboard, let owned = ownedClipboardChange,
              clipboard.changeCount == owned else { return originalClipboard == nil }
        let items = saved.map { values -> NSPasteboardItem in
            let item = NSPasteboardItem()
            for (type, data) in values { item.setData(data, forType: type) }
            return item
        }
        clipboard.clearContents()
        if !items.isEmpty { clipboard.writeObjects(items) }
        let restored = (clipboard.pasteboardItems ?? []).map { item in
            var values: [NSPasteboard.PasteboardType: Data] = [:]
            for type in item.types { if let data = item.data(forType: type) { values[type] = data } }
            return values
        }
        let verified = restored == saved
        originalClipboard = nil
        ownedClipboardChange = nil
        return verified
    }

    func events(_ input: [[String: Any]], _ app: NSRunningApplication) throws {
        guard input.count <= 256 else { throw InputError.invalid("Native action batch exceeds limit") }
        try foreground(app)
        let bounds = try geometry(app).insetBy(dx: -1, dy: -1)
        var pauseBudget = 0
        for item in input {
            guard let type = item["type"] as? String else { throw InputError.invalid("Missing action type") }
            if type == "pause" {
                let duration = item["durationMs"] as? Int ?? 0
                pauseBudget += duration
                guard duration >= 0, duration <= 2000, pauseBudget <= 10000 else {
                    throw InputError.invalid("Native pause exceeds limit")
                }
                usleep(useconds_t(duration * 1000))
                continue
            }
            if type == "keyDown" || type == "keyUp" {
                guard let key = item["key"] as? String, key.utf16.count <= 64 else {
                    throw InputError.invalid("Invalid native key")
                }
                let down = type == "keyDown"
                let code = try keyCode(key)
                if let modifier = modifier(key) {
                    if down { flags.insert(modifier.1) } else { flags.remove(modifier.1) }
                }
                guard let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else {
                    throw InputError.invalid("Could not construct native keyboard event")
                }
                let copying = down && flags.contains(.maskCommand) && ["c", "x"].contains(key.lowercased())
                if copying { rememberClipboard() }
                if modifier(key) == nil && !flags.contains(.maskCommand) && !flags.contains(.maskControl),
                   key.unicodeScalars.allSatisfy({ $0.value < 0xe000 || $0.value > 0xf8ff }) {
                    let units = Array(key.utf16)
                    event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
                }
                try post(event, app)
                if down { heldKeys[key] = code } else { heldKeys.removeValue(forKey: key) }
                if copying { usleep(45_000); ownedClipboardChange = clipboard.changeCount }
                continue
            }
            guard ["move", "down", "up"].contains(type),
                  let x = item["x"] as? Double, let y = item["y"] as? Double,
                  x.isFinite, y.isFinite, bounds.contains(CGPoint(x: x, y: y)) else {
                throw InputError.invalid("Native pointer must stay within the isolated test window")
            }
            position = CGPoint(x: x, y: y)
            let button = item["button"] as? Int ?? 0
            guard (0...2).contains(button) else { throw InputError.invalid("Unsupported pointer button") }
            let cgButton: CGMouseButton = button == 2 ? .right : button == 1 ? .center : .left
            let eventType: CGEventType
            if type == "move" {
                eventType = heldButtons.contains(0) ? .leftMouseDragged : heldButtons.contains(2) ? .rightMouseDragged : .mouseMoved
            } else if type == "down" {
                eventType = button == 0 ? .leftMouseDown : button == 2 ? .rightMouseDown : .otherMouseDown
                let now = ProcessInfo.processInfo.systemUptime
                let nearby = hypot(position.x - lastClickPosition.x, position.y - lastClickPosition.y) < 4
                clickCount = item["clickCount"] as? Int ?? (button == lastClickButton && nearby && now - lastClickTime < NSEvent.doubleClickInterval ? clickCount + 1 : 1)
                lastClickTime = now
                lastClickPosition = position
                lastClickButton = button
                heldButtons.insert(button)
            } else {
                eventType = button == 0 ? .leftMouseUp : button == 2 ? .rightMouseUp : .otherMouseUp
                heldButtons.remove(button)
            }
            guard let event = CGEvent(mouseEventSource: source, mouseType: eventType, mouseCursorPosition: position, mouseButton: cgButton) else {
                throw InputError.invalid("Could not construct native pointer event")
            }
            event.setIntegerValueField(.mouseEventClickState, value: Int64(item["clickCount"] as? Int ?? clickCount))
            try post(event, app)
        }
    }

    func release() {
        if let pid = targetPid {
            for code in heldKeys.values {
                let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false)
                event?.flags = []
                event?.postToPid(pid)
            }
            for button in heldButtons {
                let event = CGEvent(mouseEventSource: source,
                    mouseType: button == 0 ? .leftMouseUp : button == 2 ? .rightMouseUp : .otherMouseUp,
                    mouseCursorPosition: position, mouseButton: button == 2 ? .right : button == 1 ? .center : .left)
                event?.flags = []
                event?.postToPid(pid)
            }
        }
        heldKeys.removeAll()
        heldButtons.removeAll()
        flags = []
    }
}

let input = NativeInput()
defer { input.release(); input.restoreClipboard() }
while let line = readLine() {
    var id: Any = NSNull()
    do {
        guard line.utf8.count <= 65536,
              let data = line.data(using: .utf8),
              let request = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let operation = request["operation"] as? String else { throw InputError.invalid("Invalid native input request") }
        id = request["id"] ?? NSNull()
        var value: Any = NSNull()
        if operation == "shutdown" {
            input.release()
            value = ["clipboardRestoredAndVerified": input.restoreClipboard()]
        } else {
          let app = try input.target(request)
          switch operation {
        case "geometry": value = try input.geometryInfo(app)
        case "events":
            guard let events = request["events"] as? [[String: Any]] else { throw InputError.invalid("Missing native events") }
            try input.events(events, app)
        case "release": input.release()
        default: throw InputError.invalid("Unknown native input operation")
          }
        }
        let response = try JSONSerialization.data(withJSONObject: ["id": id, "ok": true, "value": value], options: [.sortedKeys])
        print(String(data: response, encoding: .utf8)!)
        fflush(stdout)
        if operation == "shutdown" { break }
    } catch {
        input.release()
        let message: String
        if case InputError.invalid(let reason) = error { message = reason } else { message = "Native input failed" }
        let data = try! JSONSerialization.data(withJSONObject: ["id": id, "ok": false, "error": message], options: [.sortedKeys])
        print(String(data: data, encoding: .utf8)!)
        fflush(stdout)
    }
}
