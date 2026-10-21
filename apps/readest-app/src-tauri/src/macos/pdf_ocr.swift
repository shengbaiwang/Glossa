// Bundled local OCR and portable-copy worker. No network, shell or third-party runtime.
import AppKit
import Foundation
import PDFKit
import Vision
import CoreText

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
    let recognizer: String?
    let emptyReason: String?
    init(index: Int, native: Bool, lines: [Word], recognizer: String? = nil, emptyReason: String? = nil) {
        self.index = index; self.native = native; self.lines = lines
        self.recognizer = recognizer; self.emptyReason = emptyReason
    }
}
struct Progress: Codable { let completed: Int; let total: Int }
let preciseRecognizer = "vision-multiscale-1"
let contentsRecognizer = "vision-contents-1"

struct RecognitionPass {
    let words: [Word]
    let emptyReason: String?
    init(words: [Word], emptyReason: String? = nil) {
        self.words = words; self.emptyReason = emptyReason
    }
}

struct RecognitionCheckpoint: Decodable {
    let index: Int
    let native: Bool
    let hasText: Bool
    let recognizer: String?
    let emptyReason: String?
    private enum CodingKeys: String, CodingKey { case index, native, lines, recognizer, emptyReason }
    init(_ page: PageText) {
        index = page.index; native = page.native; hasText = !page.lines.isEmpty; recognizer = page.recognizer
        emptyReason = page.emptyReason
    }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        index = try values.decode(Int.self, forKey: .index)
        native = try values.decode(Bool.self, forKey: .native)
        recognizer = try? values.decodeIfPresent(String.self, forKey: .recognizer)
        emptyReason = try? values.decodeIfPresent(String.self, forKey: .emptyReason)
        // Older words need not have endLine or future reading-layer fields.
        // Inspect only emptiness so a schema addition cannot replace their CFIs.
        let lines = try values.nestedUnkeyedContainer(forKey: .lines)
        hasText = !lines.isAtEnd
    }
}

func needsRecognition(_ saved: RecognitionCheckpoint?, index: Int, detect: Bool, contents: Bool = false) -> Bool {
    guard let saved, saved.index == index else { return true }
    // Nonempty and native layers own durable text offsets. Never replace them.
    // A legacy empty layer has no text offsets and gets one versioned recovery.
    return !detect && !saved.native && !saved.hasText && (saved.recognizer != (contents ? contentsRecognizer : preciseRecognizer) || saved.emptyReason == "no_word_boxes")
}

func recognizeWithRecovery(index: Int, detect: Bool, maximumDimension: Double, contents: Bool = false,
                           pass: (Double) throws -> RecognitionPass) throws -> PageText {
    var previousScale: Double?
    var emptyReason: String?
    var missingWordBoxes = false
    // Vision is not monotonic with image size: sparse titles can disappear at
    // the larger scale. The second pass still extracts precise character boxes;
    // it never promotes a detection sidecar to reading or verification evidence.
    let recognizer = contents ? contentsRecognizer : preciseRecognizer
    let scales = detect ? [1200.0] : contents ? [1200.0, 3200.0] : [3200.0, 1200.0]
    for longestEdge in scales {
        let scale = min(3, longestEdge / maximumDimension)
        if scale == previousScale { continue }
        previousScale = scale
        let result = try autoreleasepool { try pass(longestEdge) }
        emptyReason = result.emptyReason
        missingWordBoxes = missingWordBoxes || result.emptyReason == "no_word_boxes"
        if !result.words.isEmpty {
            return PageText(index: index, native: false, lines: result.words,
                            recognizer: detect ? nil : recognizer)
        }
    }
    if missingWordBoxes { throw NSError(domain: "ocr_word_boxes_missing", code: 1) }
    // Persist the attempt even for real blank pages so reopen cannot loop.
    return PageText(index: index, native: false, lines: [],
                    recognizer: detect ? nil : recognizer, emptyReason: emptyReason)
}

func write<T: Encodable>(_ value: T, to url: URL) throws {
    let data = try JSONEncoder().encode(value)
    guard data.count <= 4 * 1024 * 1024 else { throw NSError(domain: "limit", code: 1) }
    try data.write(to: url, options: .atomic)
}

func recognize(_ page: PDFPage, index: Int, detect: Bool = false, contents: Bool = false) throws -> PageText {
    // Preserve the native text layer, including its original CFI text offsets.
    if !(page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return PageText(index: index, native: true, lines: [])
    }
    var bounds = page.bounds(for: .cropBox).size
    if abs(page.rotation) % 180 == 90 { bounds = NSSize(width: bounds.height, height: bounds.width) }
    guard bounds.width > 0, bounds.height > 0 else { throw NSError(domain: "page", code: 1) }
    return try recognizeWithRecovery(index: index, detect: detect, maximumDimension: max(bounds.width, bounds.height), contents: contents) {
        try recognizeAtScale(page, bounds: bounds, detect: detect, longestEdge: $0)
    }
}

func recognizeAtScale(_ page: PDFPage, bounds: NSSize, detect: Bool, longestEdge: Double) throws -> RecognitionPass {
    let scale = min(3, longestEdge / max(bounds.width, bounds.height))
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
        if detect {
            let box = observation.boundingBox
            words.append(Word(text: text, x: box.minX, y: 1 - box.maxY, width: box.width, height: box.height, endLine: true))
            continue
        }
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
    return RecognitionPass(words: words, emptyReason: words.isEmpty ? ((request.results ?? []).isEmpty ? "no_observations" : "no_word_boxes") : nil)
}

// Produce a separate, portable copy. The original PDF and all Glossa records stay intact.
struct Region: Codable { let x: Double; let y: Double; let width: Double; let height: Double }
struct ExportNote: Codable { let index: Int; let rects: [Region]; let text: String; let style: String; let color: String }
struct ExportOutline: Codable { let title: String; let pageIndex: Int; let level: Int }
struct ExportRequest: Codable { let annotations: [ExportNote]; let outline: [ExportOutline]?; let pages: [Int] }

// PDFKit omits /PageLabels when writing. Add a narrowly scoped incremental
// catalog update to its own unencrypted, classic-xref output; reject other layouts.
func preserveLabels(_ labels: [String], in output: URL) throws {
    let attributes = try FileManager.default.attributesOfItem(atPath: output.path)
    guard let bytes = attributes[.size] as? NSNumber, bytes.int64Value <= 512 * 1024 * 1024 else { throw NSError(domain: "limit", code: 1) }
    var data = try Data(contentsOf: output)
    guard let tail = String(data: data.suffix(65536), encoding: .isoLatin1) else { throw NSError(domain: "labels", code: 1) }
    func match(_ pattern: String, _ text: String) throws -> [String] {
        let regex = try NSRegularExpression(pattern: pattern)
        guard let found = regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).last else { throw NSError(domain: "labels", code: 1) }
        return (1..<found.numberOfRanges).map { Range(found.range(at: $0), in: text).map { String(text[$0]) } ?? "" }
    }
    let trailer = try match("trailer\\s*(<<[\\s\\S]*?>>)\\s*startxref\\s*(\\d+)\\s*%%EOF", tail)
    let root = try match("/Root\\s+(\\d+)\\s+(\\d+)\\s+R", trailer[0])
    let size = try match("/Size\\s+(\\d+)", trailer[0])
    guard let object = Int(size[0]), let rootID = Int(root[0]), root[1] == "0" else { throw NSError(domain: "labels", code: 1) }
    let marker = Data("\n\(rootID) 0 obj".utf8)
    guard let start = data.range(of: marker, options: .backwards),
          let end = data.range(of: Data("endobj".utf8), in: start.upperBound..<data.endIndex) else { throw NSError(domain: "labels", code: 1) }
    var catalog = Data(data[start.upperBound..<end.lowerBound])
    guard let close = catalog.range(of: Data(">>".utf8), options: .backwards) else { throw NSError(domain: "labels", code: 1) }
    // Existing labels already preserved by a future system writer take precedence.
    if catalog.range(of: Data("/PageLabels".utf8)) != nil { return }
    catalog.insert(contentsOf: Data(" /PageLabels \(object) 0 R ".utf8), at: close.lowerBound)
    func hex(_ value: String) -> String { "FEFF" + value.utf16.map { String(format: "%04X", $0) }.joined() }
    let nums = labels.enumerated().map { "\($0.offset) << /P <\(hex($0.element))> >>" }.joined(separator: "\n")
    let labelOffset = data.count
    data.append(Data("\n\(object) 0 obj\n<< /Nums [\(nums)] >>\nendobj\n".utf8))
    let rootOffset = data.count
    data.append(Data("\(rootID) 0 obj".utf8)); data.append(catalog); data.append(Data("endobj\n".utf8))
    let xref = data.count
    var updatedTrailer = trailer[0].replacingOccurrences(of: "/Size\\s+\\d+", with: "/Size \(object + 1)", options: .regularExpression)
    updatedTrailer = updatedTrailer.replacingOccurrences(of: "/Prev\\s+\\d+", with: "", options: .regularExpression)
    updatedTrailer.insert(contentsOf: " /Prev \(trailer[1]) ", at: updatedTrailer.index(updatedTrailer.endIndex, offsetBy: -2))
    // Offset skips the separator newline before the labels object.
    data.append(Data("xref\n\(rootID) 1\n\(String(format: "%010d", rootOffset)) 00000 n \n\(object) 1\n\(String(format: "%010d", labelOffset + 1)) 00000 n \ntrailer\n\(updatedTrailer)\nstartxref\n\(xref)\n%%EOF\n".utf8))
    try data.write(to: output, options: .atomic)
}

func portablePDF(_ source: URL, cache: URL, request: URL, output: URL) throws {
    guard let document = PDFDocument(url: source), !document.isLocked, document.pageCount <= 5000 else { throw NSError(domain: "pdf", code: 1) }
    let labels = (0..<document.pageCount).map { document.page(at: $0)?.label ?? String($0 + 1) }
    let data = try Data(contentsOf: request)
    guard data.count <= 4 * 1024 * 1024 else { throw NSError(domain: "limit", code: 1) }
    let settings = try JSONDecoder().decode(ExportRequest.self, from: data)
    let originalIndices = Dictionary(uniqueKeysWithValues: (0..<document.pageCount).compactMap { i in document.page(at: i).map { (ObjectIdentifier($0), i) } })
    // An OCR overlay is vector PDF content with invisible glyphs, not a screenshot
    // or free-text annotation. Retain original page boxes, rotation and annotations.
    for index in settings.pages {
        try autoreleasepool {
            guard let original = document.page(at: index), let ref = original.pageRef else { throw NSError(domain: "page", code: 1) }
            let text = try JSONDecoder().decode(PageText.self, from: Data(contentsOf: cache.appendingPathComponent("page-\(index).json")))
            if text.native || text.lines.isEmpty { return }
            var media = original.bounds(for: .mediaBox)
            let buffer = NSMutableData()
            guard let consumer = CGDataConsumer(data: buffer), let context = CGContext(consumer: consumer, mediaBox: &media, nil) else { throw NSError(domain: "pdf", code: 1) }
            context.beginPDFPage(nil)
            context.drawPDFPage(ref)
            let crop = original.bounds(for: .cropBox)
            let rotated = abs(original.rotation) % 180 == 90
            let width = rotated ? crop.height : crop.width
            let height = rotated ? crop.width : crop.height
            let transform = ref.getDrawingTransform(.cropBox, rect: CGRect(x: 0, y: 0, width: width, height: height), rotate: 0, preserveAspectRatio: true)
            context.saveGState()
            context.concatenate(transform.inverted())
            for word in text.lines {
                let font = NSFont.systemFont(ofSize: word.height * height)
                let line = CTLineCreateWithAttributedString(NSAttributedString(string: word.text, attributes: [.font: font]))
                var ascent: CGFloat = 0, descent: CGFloat = 0
                let advance = CTLineGetTypographicBounds(line, &ascent, &descent, nil)
                guard advance > 0, ascent + descent > 0 else { continue }
                let sy = word.height * height / (ascent + descent)
                context.saveGState()
                context.translateBy(x: word.x * width, y: (1 - word.y - word.height) * height + descent * sy)
                context.scaleBy(x: word.width * width / advance, y: sy)
                context.textMatrix = .identity
                context.textPosition = .zero
                context.setTextDrawingMode(.invisible)
                CTLineDraw(line, context)
                context.restoreGState()
            }
            context.restoreGState()
            context.endPDFPage(); context.closePDF()
            guard let replacement = PDFDocument(data: buffer as Data)?.page(at: 0) else { throw NSError(domain: "pdf", code: 1) }
            replacement.rotation = original.rotation
            for box: PDFDisplayBox in [.mediaBox, .cropBox, .bleedBox, .trimBox, .artBox] { replacement.setBounds(original.bounds(for: box), for: box) }
            for annotation in original.annotations { replacement.addAnnotation(annotation) }
            document.removePage(at: index); document.insert(replacement, at: index)
        }
    }
    func restored(_ destination: PDFDestination?) -> PDFDestination? {
        guard let destination, let page = destination.page, let index = originalIndices[ObjectIdentifier(page)], let current = document.page(at: index) else { return destination }
        let result = PDFDestination(page: current, at: destination.point); result.zoom = destination.zoom; return result
    }
    func restoreOutline(_ outline: PDFOutline?) {
        guard let outline else { return }
        if let dest = restored(outline.destination) { outline.destination = dest }
        for i in 0..<outline.numberOfChildren { restoreOutline(outline.child(at: i)) }
    }
    restoreOutline(document.outlineRoot)
    for i in 0..<document.pageCount {
        for annotation in document.page(at: i)?.annotations ?? [] {
            if let action = annotation.action as? PDFActionGoTo, let dest = restored(action.destination) { action.destination = dest }
        }
    }
    for note in settings.annotations {
        guard let page = document.page(at: note.index), let ref = page.pageRef else { throw NSError(domain: "page", code: 1) }
        let crop = page.bounds(for: .cropBox)
        let rotated = abs(page.rotation) % 180 == 90
        let size = CGSize(width: rotated ? crop.height : crop.width, height: rotated ? crop.width : crop.height)
        let inverse = ref.getDrawingTransform(.cropBox, rect: CGRect(origin: .zero, size: size), rotate: 0, preserveAspectRatio: true).inverted()
        let colors: [String: NSColor] = ["yellow": .systemYellow, "red": .systemRed, "green": .systemGreen, "blue": .systemBlue, "violet": .systemPurple]
        var color = colors[note.color] ?? .systemYellow
        if note.color.hasPrefix("#"), note.color.count == 7, let hex = UInt32(note.color.dropFirst(), radix: 16) { color = NSColor(srgbRed: CGFloat((hex >> 16) & 255)/255, green: CGFloat((hex >> 8) & 255)/255, blue: CGFloat(hex & 255)/255, alpha: 1) }
        for (j, rect) in note.rects.enumerated() {
            if note.style == "text" && j > 0 { continue }
            let display = CGRect(x: rect.x * size.width, y: (1 - rect.y - rect.height) * size.height, width: rect.width * size.width, height: rect.height * size.height)
            let bounds = display.applying(inverse)
            let subtype: PDFAnnotationSubtype = note.style == "underline" ? .underline : note.style == "squiggly" ? PDFAnnotationSubtype(rawValue: "Squiggly") : note.style == "text" ? .text : .highlight
            let annotation = PDFAnnotation(bounds: bounds, forType: subtype, withProperties: nil)
            annotation.color = color
            annotation.userName = "Glossa"
            if j == 0 && !note.text.isEmpty { annotation.contents = note.text }
            page.addAnnotation(annotation)
        }
    }
    if let entries = settings.outline {
        let root = PDFOutline(); var stack = [root]
        for entry in entries {
            guard entry.level < stack.count, let page = document.page(at: entry.pageIndex) else { throw NSError(domain: "outline", code: 1) }
            let item = PDFOutline(); item.label = entry.title
            item.destination = PDFDestination(page: page, at: CGPoint(x: page.bounds(for: .cropBox).minX, y: page.bounds(for: .cropBox).maxY))
            let parent = stack[entry.level]; parent.insertChild(item, at: parent.numberOfChildren)
            stack = Array(stack.prefix(entry.level + 1)); stack.append(item)
        }
        document.outlineRoot = root
    }
    guard document.write(to: output) else { throw NSError(domain: "write", code: 1) }
    try preserveLabels(labels, in: output)
    guard let reopened = PDFDocument(url: output), reopened.pageCount == document.pageCount,
          (0..<reopened.pageCount).map({ reopened.page(at: $0)?.label ?? String($0 + 1) }) == labels else { throw NSError(domain: "write", code: 1) }
}

// Discovery reads every scanned page when relocation needs a unique heading.
// Two isolated PDFKit documents keep that bounded scan inside the import budget;
// reading/contents jobs remain serial and retain exactly the same recognizer.
func recognizePages(source: URL, output: URL, indices: [Int], detect: Bool, contents: Bool) throws {
    let lock = NSLock()
    var cursor = 0
    var completed = 0
    var failure: Error?
    try write(Progress(completed: 0, total: indices.count), to: output.appendingPathComponent("progress.json"))
    DispatchQueue.concurrentPerform(iterations: detect ? min(2, indices.count) : 1) { _ in
        do {
            guard let document = PDFDocument(url: source), !document.isLocked else { throw NSError(domain: "pdf", code: 1) }
            while true {
                lock.lock()
                guard failure == nil && cursor < indices.count else { lock.unlock(); break }
                let index = indices[cursor]
                cursor += 1
                lock.unlock()
                try autoreleasepool {
                    let target = output.appendingPathComponent("page-\(index).json")
                    let saved = (try? Data(contentsOf: target)).flatMap { try? JSONDecoder().decode(RecognitionCheckpoint.self, from: $0) }
                    if needsRecognition(saved, index: index, detect: detect, contents: contents) {
                        guard let page = document.page(at: index) else { throw NSError(domain: "page", code: 1) }
                        try write(recognize(page, index: index, detect: detect, contents: contents), to: target)
                    }
                }
                lock.lock()
                defer { lock.unlock() }
                if failure != nil { break }
                completed += 1
                do {
                    try write(Progress(completed: completed, total: indices.count), to: output.appendingPathComponent("progress.json"))
                } catch {
                    failure = error
                }
            }
        } catch {
            lock.lock()
            if failure == nil { failure = error }
            lock.unlock()
        }
    }
    if let failure { throw failure }
}

#if !PDF_OCR_TEST
do {
    var args = CommandLine.arguments
    let detect = args.count > 1 && args[1] == "--detect"
    let contents = args.count > 1 && args[1] == "--contents"
    if detect || contents { args.remove(at: 1) }
    if args.count == 6 && args[1] == "--export" {
        try portablePDF(URL(fileURLWithPath: args[2]), cache: URL(fileURLWithPath: args[3]), request: URL(fileURLWithPath: args[4]), output: URL(fileURLWithPath: args[5]))
        exit(0)
    }
    guard args.count == 4, let document = PDFDocument(url: URL(fileURLWithPath: args[1])), !document.isLocked,
          document.pageCount <= 5000 else { exit(2) }
    let output = URL(fileURLWithPath: args[2], isDirectory: true)
    let indices = args[3].split(separator: ",").compactMap { Int($0) }
    guard !indices.isEmpty, indices.count <= 5000,
          Set(indices).count == indices.count,
          indices.allSatisfy({ $0 >= 0 && $0 < document.pageCount }) else { exit(2) }
    try recognizePages(source: URL(fileURLWithPath: args[1]), output: output, indices: indices, detect: detect, contents: contents)
} catch {
    // Neither source text nor arbitrary native errors leave this worker.
    exit(1)
}
#endif
