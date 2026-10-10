"""Original, reproducible PDF reading fixture. Requires reportlab and pypdf."""
from pathlib import Path
from io import BytesIO
from reportlab.pdfgen import canvas
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, NameObject, NumberObject

target = Path(__file__).resolve().parents[1] / 'src/__tests__/fixtures/data/glossa-reading-sample.pdf'
buffer = BytesIO()
pdf = canvas.Canvas(buffer, pagesize=(600, 1400), invariant=1)
pdf.setTitle('Glossa original PDF reading sample')
pdf.setAuthor('Glossa test authors')

for index in range(4):
    pdf.bookmarkPage(f'page-{index}', fit='XYZ', left=32, top=1360, zoom=0)
    if index == 0:
        pdf.addOutlineEntry('Chapter one', f'page-{index}', level=0)
    if index == 1:
        pdf.addOutlineEntry('Chapter one: details', f'page-{index}', level=1)
    if index == 2:
        pdf.addOutlineEntry('Chapter two: notes', f'page-{index}', level=0)
    pdf.setFont('Helvetica', 20)
    pdf.drawString(32, 1360, f'Original reading sample - page {index + 1}')
    pdf.setFont('Helvetica', 16)
    pdf.drawString(32, 1290, 'Amber trees shelter a quiet reading room.')
    pdf.drawString(32, 580, f'Copper marker {index + 1} is the searchable line.')
    pdf.drawString(32, 540, 'A second line keeps selection and copying verifiable.')
    if index == 0:
        pdf.drawString(32, 1240, 'Read the linked note')
        pdf.linkAbsolute('Read the note', 'page-2', Rect=(30, 1235, 220, 1260))
    if index == 2:
        pdf.drawString(32, 1240, 'Return to the reading page')
        pdf.linkAbsolute('Return to reading', 'page-0', Rect=(30, 1235, 270, 1260))
        pdf.textAnnotation('Original embedded note for local PDF testing.', Rect=(400, 1240, 425, 1265))
    pdf.drawString(32, 120, 'Last line of this original page.')
    pdf.showPage()
pdf.save()

writer = PdfWriter()
writer.clone_document_from_reader(PdfReader(buffer))
labels = DictionaryObject({NameObject('/Nums'): ArrayObject([
    NumberObject(0), DictionaryObject({NameObject('/S'): NameObject('/r')}),
    NumberObject(2), DictionaryObject({NameObject('/S'): NameObject('/D'), NameObject('/St'): NumberObject(1)}),
])})
writer.root_object[NameObject('/PageLabels')] = labels
with target.open('wb') as stream:
    writer.write(stream)
print(target)
