// A bundled local worker. No network, shell, third-party runtime, or PDF writes.
import AppKit
import Foundation
import PDFKit
import Vision

struct Word: Codable {
    let text: String
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    var endLine: Bool
}
struct PageText: Codable {
    let index: Int
    let native: Bool
    let lines: [Word]
}
struct Progress: Codable { let completed: Int; let total: Int }

func write<T: Encodable>(_ value: T, to url: URL) throws {
    let data = try JSONEncoder().encode(value)
    guard data.count <= 4 * 1024 * 1024 else { throw NSError(domain: "limit", code: 1) }
    try data.write(to: url, options: .atomic)
}

func recognize(_ page: PDFPage, index: Int) throws -> PageText {
    // Preserve the native text layer, including its original CFI text offsets.
    if !(page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return PageText(index: index, native: true, lines: [])
    }
    var bounds = page.bounds(for: .cropBox).size
    if abs(page.rotation) % 180 == 90 { bounds = NSSize(width: bounds.height, height: bounds.width) }
    guard bounds.width > 0, bounds.height > 0 else { throw NSError(domain: "page", code: 1) }
    let scale = min(3, 3200 / max(bounds.width, bounds.height))
    let image = page.thumbnail(of: NSSize(width: bounds.width * scale, height: bounds.height * scale), for: .cropBox)
    var rect = NSRect(origin: .zero, size: image.size)
    guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
        throw NSError(domain: "render", code: 1)
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    let supported = try request.supportedRecognitionLanguages()
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"].filter { supported.contains($0) }
    if #available(macOS 13, *) { request.automaticallyDetectsLanguage = true }
    try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
    var words: [Word] = []
    // Vision supplies reading order; retain it across rendering, search and reopen.
    for observation in request.results ?? [] {
        guard let candidate = observation.topCandidates(1).first else { continue }
        let text = candidate.string
        var cursor = text.startIndex
        let start = words.count
        while cursor < text.endIndex {
            if text[cursor].isWhitespace { cursor = text.index(after: cursor); continue }
            let begin = cursor
            let cjk = text[cursor].unicodeScalars.contains { (0x2E80...0x9FFF).contains($0.value) }
            cursor = text.index(after: cursor)
            if !cjk {
                while cursor < text.endIndex && !text[cursor].isWhitespace &&
                    !text[cursor].unicodeScalars.contains(where: { (0x2E80...0x9FFF).contains($0.value) }) {
                    cursor = text.index(after: cursor)
                }
            }
            guard let box = try candidate.boundingBox(for: begin..<cursor)?.boundingBox else { continue }
            let x = max(0, min(1, box.minX)), y = max(0, min(1, 1 - box.maxY))
            let width = min(box.width, 1 - x), height = min(box.height, 1 - y)
            guard width > 0, height > 0 else { continue }
            var value = String(text[begin..<cursor])
            if cursor < text.endIndex && text[cursor].isWhitespace { value += " " }
            words.append(Word(text: value, x: x, y: y, width: width, height: height, endLine: false))
            guard words.count <= 10000 else { throw NSError(domain: "limit", code: 1) }
        }
        if words.count > start { words[words.count - 1].endLine = true }
    }
    guard words.reduce(0, { $0 + $1.text.count }) <= 100000 else { throw NSError(domain: "limit", code: 1) }
    return PageText(index: index, native: false, lines: words)
}

do {
    let args = CommandLine.arguments
    guard args.count == 4, let document = PDFDocument(url: URL(fileURLWithPath: args[1])), !document.isLocked,
          document.pageCount <= 5000 else { exit(2) }
    let output = URL(fileURLWithPath: args[2], isDirectory: true)
    let indices = args[3].split(separator: ",").compactMap { Int($0) }
    guard !indices.isEmpty, indices.count <= 5000,
          indices.allSatisfy({ $0 >= 0 && $0 < document.pageCount }) else { exit(2) }
    var completed = 0
    try write(Progress(completed: completed, total: indices.count), to: output.appendingPathComponent("progress.json"))
    for index in indices {
        try autoreleasepool {
            let target = output.appendingPathComponent("page-\(index).json")
            if !FileManager.default.fileExists(atPath: target.path) {
                guard let page = document.page(at: index) else { throw NSError(domain: "page", code: 1) }
                try write(recognize(page, index: index), to: target)
            }
            completed += 1
            try write(Progress(completed: completed, total: indices.count), to: output.appendingPathComponent("progress.json"))
        }
    }
} catch {
    // Neither source text nor arbitrary native errors leave this worker.
    exit(1)
}
