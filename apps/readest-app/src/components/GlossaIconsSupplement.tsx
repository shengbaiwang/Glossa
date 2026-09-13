import { Clock as ClockGlyph, TriangleAlert as TriangleAlertGlyph } from 'lucide-react';
import {
  Accessibility as AccessibilityGlyph,
  ArrowLeft as ArrowLeftGlyph,
  ArrowRight as ArrowRightGlyph,
  Braces as BracesGlyph,
  ChevronUp as ChevronUpGlyph,
  Circle as CircleGlyph,
  CircleAlert as CircleAlertGlyph,
  CircleCheck as CircleCheckGlyph,
  CirclePlay as CirclePlayGlyph,
  CircleUserRound as CircleUserRoundGlyph,
  CircleX as CircleXGlyph,
  Cloud as CloudGlyph,
  CloudAlert as CloudAlertGlyph,
  CloudDownload as CloudDownloadGlyph,
  CloudOff as CloudOffGlyph,
  CloudSync as CloudSyncGlyph,
  CloudUpload as CloudUploadGlyph,
  Columns2 as Columns2Glyph,
  Contrast as ContrastGlyph,
  CopyCheck as CopyCheckGlyph,
  Database as DatabaseGlyph,
  Download as DownloadGlyph,
  ExternalLink as ExternalLinkGlyph,
  Eye as EyeGlyph,
  EyeOff as EyeOffGlyph,
  File as FileGlyph,
  FilePlus2 as FilePlus2Glyph,
  FolderMinus as FolderMinusGlyph,
  FolderOpen as FolderOpenGlyph,
  FolderPlus as FolderPlusGlyph,
  FolderX as FolderXGlyph,
  GalleryHorizontal as GalleryHorizontalGlyph,
  GalleryVertical as GalleryVerticalGlyph,
  Gauge as GaugeGlyph,
  GripVertical as GripVerticalGlyph,
  Hand as HandGlyph,
  Headphones as HeadphonesGlyph,
  ListX as ListXGlyph,
  LoaderCircle as LoaderCircleGlyph,
  Lock as LockGlyph,
  LockOpen as LockOpenGlyph,
  MessageSquare as MessageSquareGlyph,
  Minus as MinusGlyph,
  Moon as MoonGlyph,
  MoveHorizontal as MoveHorizontalGlyph,
  MoveVertical as MoveVerticalGlyph,
  Palette as PaletteGlyph,
  PanelsTopLeft as PanelsTopLeftGlyph,
  Pipette as PipetteGlyph,
  Radio as RadioGlyph,
  RectangleHorizontal as RectangleHorizontalGlyph,
  RectangleVertical as RectangleVerticalGlyph,
  RotateCcw as RotateCcwGlyph,
  RotateCw as RotateCwGlyph,
  SearchX as SearchXGlyph,
  Send as SendGlyph,
  Server as ServerGlyph,
  Settings2 as Settings2Glyph,
  Share2 as Share2Glyph,
  Smartphone as SmartphoneGlyph,
  SunMoon as SunMoonGlyph,
  ZoomIn as ZoomInGlyph,
  ZoomOut as ZoomOutGlyph,
  type LucideIcon,
} from 'lucide-react';
import type { GlossaIconProps } from './GlossaIcons';

/** Secondary functional glyphs retain Lucide geometry and attribution, with
 * the same drawing/props contract as Glossa's reading-specific silhouettes. */
function glossaGlyph(Glyph: LucideIcon) {
  return function GlossaGlyph({ size = 24, className, ...props }: GlossaIconProps) {
    return (
      <Glyph
        size={size}
        strokeWidth={1.8}
        strokeLinecap='round'
        strokeLinejoin='round'
        aria-hidden='true'
        className={className ? `glossa-icon ${className}` : 'glossa-icon'}
        {...props}
      />
    );
  };
}

export const Accessibility = /* @__PURE__ */ glossaGlyph(AccessibilityGlyph);
export const ArrowLeft = /* @__PURE__ */ glossaGlyph(ArrowLeftGlyph);
export const ArrowRight = /* @__PURE__ */ glossaGlyph(ArrowRightGlyph);
export const Braces = /* @__PURE__ */ glossaGlyph(BracesGlyph);
export const ChevronUp = /* @__PURE__ */ glossaGlyph(ChevronUpGlyph);
export const Circle = /* @__PURE__ */ glossaGlyph(CircleGlyph);
export const CircleAlert = /* @__PURE__ */ glossaGlyph(CircleAlertGlyph);
export const CircleCheck = /* @__PURE__ */ glossaGlyph(CircleCheckGlyph);
export const CirclePlay = /* @__PURE__ */ glossaGlyph(CirclePlayGlyph);
export const CircleUserRound = /* @__PURE__ */ glossaGlyph(CircleUserRoundGlyph);
export const CircleX = /* @__PURE__ */ glossaGlyph(CircleXGlyph);
export const Cloud = /* @__PURE__ */ glossaGlyph(CloudGlyph);
export const CloudAlert = /* @__PURE__ */ glossaGlyph(CloudAlertGlyph);
export const CloudDownload = /* @__PURE__ */ glossaGlyph(CloudDownloadGlyph);
export const CloudOff = /* @__PURE__ */ glossaGlyph(CloudOffGlyph);
export const CloudSync = /* @__PURE__ */ glossaGlyph(CloudSyncGlyph);
export const CloudUpload = /* @__PURE__ */ glossaGlyph(CloudUploadGlyph);
export const Columns2 = /* @__PURE__ */ glossaGlyph(Columns2Glyph);
export const Contrast = /* @__PURE__ */ glossaGlyph(ContrastGlyph);
export const CopyCheck = /* @__PURE__ */ glossaGlyph(CopyCheckGlyph);
export const Database = /* @__PURE__ */ glossaGlyph(DatabaseGlyph);
export const Download = /* @__PURE__ */ glossaGlyph(DownloadGlyph);
export const ExternalLink = /* @__PURE__ */ glossaGlyph(ExternalLinkGlyph);
export const Eye = /* @__PURE__ */ glossaGlyph(EyeGlyph);
export const EyeOff = /* @__PURE__ */ glossaGlyph(EyeOffGlyph);
export const File = /* @__PURE__ */ glossaGlyph(FileGlyph);
export const FilePlus2 = /* @__PURE__ */ glossaGlyph(FilePlus2Glyph);
export const FolderMinus = /* @__PURE__ */ glossaGlyph(FolderMinusGlyph);
export const FolderOpen = /* @__PURE__ */ glossaGlyph(FolderOpenGlyph);
export const FolderPlus = /* @__PURE__ */ glossaGlyph(FolderPlusGlyph);
export const FolderX = /* @__PURE__ */ glossaGlyph(FolderXGlyph);
export const GalleryHorizontal = /* @__PURE__ */ glossaGlyph(GalleryHorizontalGlyph);
export const GalleryVertical = /* @__PURE__ */ glossaGlyph(GalleryVerticalGlyph);
export const Gauge = /* @__PURE__ */ glossaGlyph(GaugeGlyph);
export const GripVertical = /* @__PURE__ */ glossaGlyph(GripVerticalGlyph);
export const Hand = /* @__PURE__ */ glossaGlyph(HandGlyph);
export const Headphones = /* @__PURE__ */ glossaGlyph(HeadphonesGlyph);
export const ListX = /* @__PURE__ */ glossaGlyph(ListXGlyph);
export const LoaderCircle = /* @__PURE__ */ glossaGlyph(LoaderCircleGlyph);
export const Lock = /* @__PURE__ */ glossaGlyph(LockGlyph);
export const LockOpen = /* @__PURE__ */ glossaGlyph(LockOpenGlyph);
export const MessageSquare = /* @__PURE__ */ glossaGlyph(MessageSquareGlyph);
export const Minus = /* @__PURE__ */ glossaGlyph(MinusGlyph);
export const Moon = /* @__PURE__ */ glossaGlyph(MoonGlyph);
export const MoveHorizontal = /* @__PURE__ */ glossaGlyph(MoveHorizontalGlyph);
export const MoveVertical = /* @__PURE__ */ glossaGlyph(MoveVerticalGlyph);
export const Palette = /* @__PURE__ */ glossaGlyph(PaletteGlyph);
export const PanelsTopLeft = /* @__PURE__ */ glossaGlyph(PanelsTopLeftGlyph);
export const Pipette = /* @__PURE__ */ glossaGlyph(PipetteGlyph);
export const Radio = /* @__PURE__ */ glossaGlyph(RadioGlyph);
export const RectangleHorizontal = /* @__PURE__ */ glossaGlyph(RectangleHorizontalGlyph);
export const RectangleVertical = /* @__PURE__ */ glossaGlyph(RectangleVerticalGlyph);
export const RotateCcw = /* @__PURE__ */ glossaGlyph(RotateCcwGlyph);
export const RotateCw = /* @__PURE__ */ glossaGlyph(RotateCwGlyph);
export const SearchX = /* @__PURE__ */ glossaGlyph(SearchXGlyph);
export const Send = /* @__PURE__ */ glossaGlyph(SendGlyph);
export const Server = /* @__PURE__ */ glossaGlyph(ServerGlyph);
export const Settings2 = /* @__PURE__ */ glossaGlyph(Settings2Glyph);
export const Share2 = /* @__PURE__ */ glossaGlyph(Share2Glyph);
export const Smartphone = /* @__PURE__ */ glossaGlyph(SmartphoneGlyph);
export const SunMoon = /* @__PURE__ */ glossaGlyph(SunMoonGlyph);
export const ZoomIn = /* @__PURE__ */ glossaGlyph(ZoomInGlyph);
export const ZoomOut = /* @__PURE__ */ glossaGlyph(ZoomOutGlyph);

export const Clock = /* @__PURE__ */ glossaGlyph(ClockGlyph);
export const TriangleAlert = /* @__PURE__ */ glossaGlyph(TriangleAlertGlyph);
