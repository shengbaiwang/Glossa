// Deterministic recovery and cache compatibility checks. Appended to the worker
// under PDF_OCR_TEST; production retains no test command or request override.
let originalWord = Word(text: "原", x: 0.2, y: 0.3, width: 0.03, height: 0.04, endLine: false)
let finalWord = Word(text: "文", x: 0.24, y: 0.3, width: 0.03, height: 0.04, endLine: true)
let preciseWords = [originalWord, finalWord]
for emptyReason in ["no_observations", "no_word_boxes"] {
    var calls: [Double] = []
    let recovered = try recognizeWithRecovery(index: 4, detect: false, maximumDimension: 900) { edge in
        calls.append(edge)
        return edge == 3200 ? RecognitionPass(words: [], emptyReason: emptyReason) : RecognitionPass(words: preciseWords)
    }
    assert(calls == [3200, 1200])
    assert(recovered.lines.count == 2 && recovered.lines[1].endLine)
    assert(recovered.lines[0].width == originalWord.width)
    assert(recovered.recognizer == preciseRecognizer && recovered.emptyReason == nil)
}
var primaryCalls = 0
let primary = try recognizeWithRecovery(index: 4, detect: false, maximumDimension: 900) { _ in
    primaryCalls += 1
    return RecognitionPass(words: preciseWords)
}
assert(primaryCalls == 1 && primary.lines.count == 2)
var blankCalls = 0
let blank = try recognizeWithRecovery(index: 4, detect: false, maximumDimension: 900) { _ in
    blankCalls += 1
    return RecognitionPass(words: [], emptyReason: "no_observations")
}
assert(blankCalls == 2 && blank.recognizer == preciseRecognizer)
assert(blank.emptyReason == "no_observations")
for reasons in [["no_word_boxes", "no_word_boxes"], ["no_word_boxes", "no_observations"], ["no_observations", "no_word_boxes"]] {
    var attempt = 0
    do {
        _ = try recognizeWithRecovery(index: 4, detect: false, maximumDimension: 900) { _ in
            defer { attempt += 1 }
            return RecognitionPass(words: [], emptyReason: reasons[attempt])
        }
        assertionFailure("observed text without character boxes must fail, not become a permanent blank")
    } catch {
        assert(attempt == 2)
    }
}
assert(!needsRecognition(RecognitionCheckpoint(blank), index: 4, detect: false))
var detectionCalls = 0
let detection = try recognizeWithRecovery(index: 4, detect: true, maximumDimension: 900) { _ in
    detectionCalls += 1
    return RecognitionPass(words: [])
}
assert(detectionCalls == 1 && detection.recognizer == nil)
var duplicateCalls = 0
_ = try recognizeWithRecovery(index: 4, detect: false, maximumDimension: 300) { _ in
    duplicateCalls += 1
    return RecognitionPass(words: [])
}
assert(duplicateCalls == 1, "do not retry an identical capped raster")
var contentsCalls: [Double] = []
let contentsText = try recognizeWithRecovery(index: 4, detect: false, maximumDimension: 900, contents: true) { edge in
    contentsCalls.append(edge)
    return RecognitionPass(words: preciseWords)
}
assert(contentsCalls == [1200] && contentsText.recognizer == contentsRecognizer)
assert(contentsText.lines.count == 2, "contents evidence retains character boxes")
contentsCalls = []
let contentsBlank = try recognizeWithRecovery(index: 4, detect: false, maximumDimension: 900, contents: true) { edge in
    contentsCalls.append(edge)
    return RecognitionPass(words: [], emptyReason: "no_observations")
}
assert(contentsCalls == [1200, 3200] && contentsBlank.recognizer == contentsRecognizer)
assert(!needsRecognition(RecognitionCheckpoint(contentsBlank), index: 4, detect: false, contents: true))
assert(needsRecognition(RecognitionCheckpoint(blank), index: 4, detect: false, contents: true))
let headingBlank = PageText(index: 4, native: false, lines: [], recognizer: headingRecognizer, emptyReason: "no_observations", alternatives: [[]])
assert(!needsRecognition(RecognitionCheckpoint(headingBlank), index: 4, detect: false, heading: true))
assert(needsRecognition(RecognitionCheckpoint(blank), index: 4, detect: false, heading: true))
enum TestError: Error { case stopped }
var failedCalls = 0
do {
    _ = try recognizeWithRecovery(index: 4, detect: false, maximumDimension: 900) { _ in
        failedCalls += 1
        throw TestError.stopped
    }
    assertionFailure("recognition errors must propagate")
} catch TestError.stopped {
    assert(failedCalls == 1)
}
let legacyEmpty = try JSONDecoder().decode(RecognitionCheckpoint.self, from: Data(#"{"index":4,"native":false,"lines":[]}"#.utf8))
assert(needsRecognition(legacyEmpty, index: 4, detect: false))
assert(!needsRecognition(legacyEmpty, index: 4, detect: true))
assert(!needsRecognition(RecognitionCheckpoint(PageText(index: 4, native: true, lines: [])), index: 4, detect: false))
assert(!needsRecognition(RecognitionCheckpoint(PageText(index: 4, native: false, lines: preciseWords)), index: 4, detect: false))
let legacyText = try JSONDecoder().decode(RecognitionCheckpoint.self, from: Data(#"{"index":4,"native":false,"lines":[{"text":"unchanged","x":0.2,"y":0.3,"width":0.2,"height":0.04}]}"#.utf8))
assert(!needsRecognition(legacyText, index: 4, detect: false), "legacy words without endLine remain untouched")
assert(needsRecognition(nil, index: 4, detect: false))
let reopenedBlank = try JSONDecoder().decode(PageText.self, from: JSONEncoder().encode(blank))
assert(!needsRecognition(RecognitionCheckpoint(reopenedBlank), index: 4, detect: false))
// Exercise the actual detection batch writer with isolated PDFKit documents.
let batchRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
try FileManager.default.createDirectory(at: batchRoot, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: batchRoot) }
let batchSource = batchRoot.appendingPathComponent("native.pdf")
var batchMedia = CGRect(x: 0, y: 0, width: 200, height: 300)
let batchConsumer = CGDataConsumer(url: batchSource as CFURL)!
let batchContext = CGContext(consumer: batchConsumer, mediaBox: &batchMedia, nil)!
for index in 0..<16 {
    batchContext.beginPDFPage(nil)
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: "Native page \(index)", attributes: [.font: NSFont.systemFont(ofSize: 16)]))
    batchContext.textPosition = CGPoint(x: 10, y: 250)
    CTLineDraw(line, batchContext)
    batchContext.endPDFPage()
}
batchContext.closePDF()
let preservedTarget = batchRoot.appendingPathComponent("page-4.json")
let preservedBytes = try JSONEncoder().encode(PageText(index: 4, native: false, lines: preciseWords))
try preservedBytes.write(to: preservedTarget)
try recognizePages(source: batchSource, output: batchRoot, indices: Array(0..<16), detect: true, contents: false)
let retainedBytes = try Data(contentsOf: preservedTarget)
assert(retainedBytes == preservedBytes, "detection batch must preserve existing checkpoints")
for index in 0..<16 where index != 4 {
    let page = try JSONDecoder().decode(PageText.self, from: Data(contentsOf: batchRoot.appendingPathComponent("page-\(index).json")))
    assert(page.index == index && page.native)
}
let batchProgress = try JSONDecoder().decode(Progress.self, from: Data(contentsOf: batchRoot.appendingPathComponent("progress.json")))
assert(batchProgress.completed == 16 && batchProgress.total == 16)
do {
    try recognizePages(source: batchSource, output: batchRoot, indices: [-1, 1], detect: false, contents: false)
    assertionFailure("a failed page must stop the batch")
} catch {
    let progress = try JSONDecoder().decode(Progress.self, from: Data(contentsOf: batchRoot.appendingPathComponent("progress.json")))
    assert(progress.completed == 0 && progress.total == 2)
}
print("bounded OCR recovery, separate contents evidence and legacy text offsets verified")
