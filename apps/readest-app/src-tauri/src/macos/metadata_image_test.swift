// Appended to pdf_ocr.swift under PDF_OCR_TEST: actual Vision OCR on original test artwork.
func testImage(_ width: Int, _ height: Int, _ lines: [String], _ path: URL) throws {
    guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fatalError("context") }
    context.setFillColor(CGColor(gray: 1, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    let font = CTFontCreateWithName("Helvetica" as CFString, 42, nil)
    for (i, text) in lines.enumerated() {
        context.textPosition = CGPoint(x: 50, y: height - 100 - i * 80)
        let value = NSAttributedString(string: text, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0, alpha: 1)])
        CTLineDraw(CTLineCreateWithAttributedString(value), context)
    }
    guard let raster = context.makeImage(), let target = CGImageDestinationCreateWithURL(path as CFURL, "public.png" as CFString, 1, nil) else { fatalError("image") }
    CGImageDestinationAddImage(target, raster, nil); assert(CGImageDestinationFinalize(target))
}
do {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("glossa-metadata-image-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: dir) }
    let image = dir.appendingPathComponent("original.png"), output = dir.appendingPathComponent("result.txt")
    try testImage(1500, 900, ["LOCAL METADATA TEST", "Publisher: Glossa Test Press", "ISBN 978-0-306-40615-7", "Published: 2020"], image)
    try recognizeEmbeddedImage(source: image, output: output)
    let text = try String(contentsOf: output, encoding: .utf8)
    assert(text.contains("Glossa Test Press"), "publisher must survive actual Vision OCR")
    assert(text.contains("978-0-306-40615-7"), "ISBN must survive actual Vision OCR")
    if let evidencePath = ProcessInfo.processInfo.environment["GLOSSA_METADATA_OCR_EVIDENCE"] {
        let evidence = URL(fileURLWithPath: evidencePath, isDirectory: true)
        try FileManager.default.createDirectory(at: evidence, withIntermediateDirectories: true)
        try Data(contentsOf: image).write(to: evidence.appendingPathComponent("original.png"), options: .atomic)
        try text.write(to: evidence.appendingPathComponent("result.txt"), atomically: true, encoding: .utf8)
    }
    try Data([0, 1, 2]).write(to: image)
    do { try recognizeEmbeddedImage(source: image, output: output); assertionFailure("invalid image must be rejected") } catch {}
    try testImage(20001, 1, [], image)
    do { try recognizeEmbeddedImage(source: image, output: output); assertionFailure("oversized dimensions must be rejected before recognition") } catch {}
    print("metadata image OCR: synthetic publisher/ISBN + invalid image + dimension budget passed")
}
