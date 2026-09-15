## Glossa Design Language

### Shared interface foundations — 2026-09-14

Unify controls with the same role; preserve the difference between a full page,
a settings sheet, a compact reading pane and document content. These rules supersede
older typography, spacing, focus and form-chrome guidance below. Implementation lives
in `src/styles/glossa-foundations.css`, imported by `glossa.css`, and the shared
settings, menu, dialog and form primitives. Use semantic classes and tokens, never
blanket `h1`, `button`, `input` or `svg` overrides across the reader document.

#### Typography and color

| Role | Size / line height / weight | Usage |
| --- | --- | --- |
| Desktop page title | 26px / 1.35 / 600 | Library page heading; compact/narrow library keeps its responsive scale |
| Dialog or settings subpage title | 16px / 1.35 / 600 | `glossa-dialog-title`; one title per surface |
| Collection heading | 15px / 1.5 / 500–600 | Groups within the library |
| Standard UI body and menus | 14px / 1.5 / 400 | Settings labels, forms, menu rows; 16px at widths ≤768px |
| Compact pane chrome | 13px / 1.5 / 400–500 | Conversation/map toolbar labels; menus still use the standard menu role |
| Group heading | 12px / 1.5 / 500 | `SectionTitle` / `glossa-section-title`; no forced uppercase or letter spacing |
| Supporting text | 12px / 1.5 / 400 | `glossa-supporting-text`: status, descriptions, keyboard shortcuts |

Tokens: `--glossa-text-page-title/dialog-title/subheading/body/compact/section/caption`,
`--glossa-leading-title/ui`, `--glossa-weight-title/label`. Main text uses
`--glossa-ink`, secondary text uses `--glossa-muted`; disabled styling is a state,
not a third arbitrary gray palette. Keep meaningful error/warning/success colors.
Book text, font previews, user-sized chat answers, map nodes, PIN digits and artwork
retain their own typography. Avoid shrinking essential instructions into captions.

#### Spacing and alignment

- Reuse 8px icon/text and action gaps, 12px between settings label and value,
  16px pane insets, 24px dialog body insets and section separation. Tokens are
  `--glossa-space-inline/row/section` and `--glossa-inset-panel/dialog`.
- Standard settings rows are at least 56px; navigation rows with an icon/status
  are at least 64px. Allow wrapped labels to grow. Use `BoxedList`, `SettingsRow`,
  `NavigationRow`, `SettingsSwitchRow`; do not duplicate their chassis.
- Group dividers start at the label column and stop at the trailing value inset.
  Text values, chevrons and switches share the same trailing edge. Use logical
  `start/end`, `ps/pe`, `gap`, and `text-start`; mirror directional chevrons in RTL.
- Menus use 6px surface padding, 36px minimum rows, 7px block padding, 8px icon/text
  spacing and 9px row corners. Multiline descriptions grow the row. Do not compress
  text menus to the 28px icon-only tool target.
- Preserve existing 2px pane-icon gaps, 4px library-icon gaps, safe areas, measured
  reading insets and settings' explicitly compact 20px reader-sheet inset.

#### Action-menu icon grammar (2026-09-15)

- Reading “more” menu commands and submenu headings always carry a stable leading
  functional icon from `GlossaIcons`: 16px, 24-unit grid, 1.8-unit rounded stroke,
  theme ink. Reuse existing glyphs; no per-item decorative badges or colored tiles.
- `MenuItem` reserves a non-shrinking icon column with an 8px gap before the label.
  Icons remain visible in both enabled and disabled states; disabled styling dims
  the whole row. Text stays the primary name of the action.
- With a functional `Icon`, pass `toggled` for boolean settings. Keep the functional
  icon at the start and show a check in a reserved trailing slot when enabled.
  Shortcuts precede that slot; submenu expansion keeps its own trailing chevron.
  Use logical start/end order so the arrangement mirrors in RTL.
- Pure radio/checkbox option lists use their choice indicators without requiring
  a separate icon for every value. Book selectors may retain cover thumbnails.
  Do not add icons to separators or explanatory/group text.

#### Interaction states

- Resting actions are neutral. Hover uses `--glossa-hover` (7% theme ink); a selected
  destination or checked choice uses `--glossa-selected` (13%). Hovering the selected
  choice retains that state. An action such as Import does not stay selected.
- Pane destinations use the existing exclusive `ReaderPaneTabs`. Menu switches use
  `menuitemcheckbox` + `aria-checked`; ordinary commands use `menuitem`. Radix radio
  and checkbox items keep their native semantics and visible check indicators.
- Standalone controls use a 2px theme-ink keyboard outline with a 2px outside
  offset; navigation rows use an inset outline. Menus follow the borderless row
  state rules below. A settings select draws the ring on its value+chevron wrapper;
  a translucent custom slider draws it on the visible slider wrapper. Never hide
  focus on both wrapper and input.
- Disabled actions use native `disabled` and 0.45 opacity. Do not simulate disabled
  behavior solely with CSS or tabIndex. A disabled row dims once, not twice. Number
  steppers disable unavailable directions at their limits. Invalid fields keep a
  semantic error boundary; error text must remain available beside the field.

#### Reusable menu row states — 2026-09-15

- Match the reading sidebar: resting rows are transparent; hover uses
  `--glossa-hover`; selected/checked rows use `--glossa-selected` and theme ink.
  A selected row keeps its selected fill when hovered or focused. Use the same
  size, alignment and weight for peer choices; never promote one to a framed button.
- No white outline, perimeter ring or shadow on menu row hover, selection or
  focus. Radix `data-highlighted` represents pointer hover as well as focus, so it
  must never add a focus ring. The menu surface keeps its own quiet border.
- Keyboard `:focus-visible` adds a 1px text underline with a 4px offset. Keep
  native radio dots/checkbox checks to identify selection independently of focus.
  Preserve arrow-key navigation, disabled semantics, Escape and focus restoration.
- These rules apply to shared `.glossa-menu-surface` rows (`.glossa-choice-row`
  and `.glossa-menu-item`) via `glossa-foundations.css`. Reuse them for future
  menus instead of local outline overrides. In e-ink, preserve selection indicators,
  underline keyboard focus and the surface border; do not outline selected rows.
  Standalone fields, buttons and navigation retain their own focus treatments.

#### Menus, dialogs and actions

- Menus/popovers: 12px surface corners, one theme border and shared elevation.
  Use `glossa-menu-surface` for portaled primitives; full menu containers own their
  border/shadow so nested containers do not produce double frames.
- Short form/confirmation dialogs: `glossa-dialog-card`, 20px corners, 24px padding,
  16px content rhythm and the shared shadow. Long task sheets keep their scrolling
  chassis through `glossa-dialog-surface` and `glossa-dialog-body`; mobile sheets
  retain their edge geometry, drag handle and safe-area treatment.
- Actions sit at the trailing edge: Cancel first, primary action last, 8px gap,
  wrapping when needed. Ordinary primary actions use solid theme ink; Cancel is
  quiet. Keep destructive operations labeled and semantically colored.
- Desktop close stays at the trailing top edge. Mobile navigation sheets retain
  their leading Back control. Keep the existing Escape, overlay-dismiss, focus
  return, native-window and busy/protected-flow behavior; styling must not make a
  protected dialog dismissible or introduce a second close action.

#### Forms and reuse

- Framed forms use `Input` / `glossa-field`, native `.input/.select/.textarea` in
  settings/dialogs, or the shared Radix Select. Standard height is 36px, border
  is 1px theme ink, radius 9px. Textareas grow; color swatches and PIN cells keep
  their specialized geometry. Do not wrap a row value in another framed field.
- Attached settings values use `SettingsInput` / `SettingsSelect`, transparent at
  rest, with the same 36px height and visible keyboard focus. Values align to the
  trailing edge; fields intended for entry align with their labels.
- `Toggle` retains the switch silhouette and explicit thumb position. `Slider`
  retains its continuous track, value bubble and existing drag/keyboard mapping;
  the reader progress slider remains a separate navigation control.
- Shared `Button` uses neutral primary/secondary/outline/ghost roles. Standard form
  actions are 36px, compact text actions 32px; page-level `glossa-button` remains
  40px and icon controls follow the icon table. Touch fields/menu rows/actions have
  at least 44px targets; switches retain their enclosing 56px label target.
- E-ink removes elevation, keeps explicit borders/checks and full-contrast text.
  Reduced motion retains the existing app-wide policy. Test light/dark, keyboard,
  disabled/selected states, narrow width and RTL when changing shared roles.

```tsx
<BoxedList title={_('Display')}>
  <SettingsRow label={_('Name')}>
    <SettingsInput aria-label={_('Name')} value={name} onChange={handleName} />
  </SettingsRow>
</BoxedList>

<DialogContent>
  <DialogTitle>{_('Edit')}</DialogTitle>
  <Input aria-label={_('Title')} />
  <DialogFooter>
    <Button variant='ghost' onClick={close}>{_('Cancel')}</Button>
    <Button onClick={save}>{_('Save')}</Button>
  </DialogFooter>
</DialogContent>
```

### Search workspace — 2026-09-15

- Reader search uses a 36px framed field with an inline clear action, then a
  compact “Entire book / Current chapter” scope group and a trailing options
  trigger. Use 16px side insets, 8px vertical rhythm, shared 13px chrome and
  paper/ink tokens. Controls flow onto a second line at narrow widths instead
  of overlapping; touch targets grow to 44px.
- Use one options menu with a single mode group: 普通 / 全词 / 邻近 / 正则
  (Normal / Whole word / Nearby / Regex), under 方式 (Method). Below a divider,
  show independent 区分大小写 / 区分变音符号 switches. Whole word appears only in
  the mode group, never again as a checkbox. Regex retains the disabled diacritics
  behavior. No advanced page or repeated search-options heading.
- The trigger stays 选项 (Options); the input placeholder stays 搜索书内文字
  (Search book text), with 全书 / 本章 expressing scope. Use 搜索 consistently
  for user-facing search actions; do not alternate 查找 and 检索 in search chrome.
  Preserve precise established terms such as 变音符号 rather than shortening
  every label to the same character count.
- Show the inline 5 / 10 / 20 / 50 radio group under 距离（词） only for Nearby.
  Changes stay in the same open menu so multiple settings can be adjusted.
  恢复默认 appears after a divider only for non-default settings and resets mode,
  switches and distance. Restore trigger focus on Escape or dismissal. Follow the
  shared borderless menu states above; preserve native radio/checkbox semantics.
- Results are transparent compact rows, with a quiet sticky chapter heading,
  three-line text previews, shared paper highlights and an inset focus ring.
  Keep source text direction independent of interface direction. Use one
  small floating navigation surface with query, LTR numeric position/total,
  previous/next match, list, close and return-to-reading actions. No separate
  framed previous/next buttons and no tutorial captions.
- Loading, cancellation, retry and result-cap messages appear only when
  relevant. Keep content and history local, do not log queries, and retain
  ordinary search modes and old configuration compatibility.
- Implementation: `glossa-search.css`, reader `SearchBar`, `SearchOptions`,
  `SearchResults`, `SearchResultsNav`. Keep shared library search behavior
  unchanged; its existing retrieval modes remain available.

### Bookmarks — saved positions, 2026-09-15

- Bookmarks navigate; notes record. Pair the chapter heading and trailing page
  label on one baseline, followed by a muted two-line, read-only location preview.
  Place Delete at the trailing edge of the preview, without a separate footer. No editing or
  copy actions; a small trailing Delete icon acts directly. Reveal it on row hover
  or keyboard focus, and disable pointer hits while hidden; touch keeps it visible. Creation time
  remains available through the row metadata tooltip.
- Use 13px/500 chapter headings, 13px/400 previews with 1.5 line height, and
  12px page labels. Keep 4px between metadata and preview. Rows use 8px
  outer insets plus 8px inner padding, 10px vertical padding, 4px vertical margins
  and shared 8px detail corners. Preview controls reserve their space while hidden. No separators or resting card backgrounds;
  soften shared hover/current washes to 70%/75% of their original strength;
  keep the shared keyboard focus outline. Keep the deletion button clear of
  preview text, with 44px targets on touch and keyboard access.
- The left Bookmarks destination uses overlapping ribbons (`Bookmarks`); the
  reader header uses a single ribbon with a plus (`BookmarkPlus`) for adding,
  and a filled ribbon (`Bookmark`) when saved. All use the shared drawing grid.
- The empty list shows only its symbol and “No Bookmarks”. Adding lives in the
  reader header; do not add another sidebar action or explanatory caption.
- Preserve existing bookmark records, location anchors, soft deletion and sync.
- The decorative page ribbon sits 12px inside the right edge, clear of the
  reading page's 10px corner. Use an 18px width, 34px body plus the top safe area,
  and a fixed 6px notch so the tail stays shallow on devices with a notch.
  Its warm red (#b56b59 at 85%, blended with theme ink) is a small bookmark
  accent; e-ink uses solid theme ink. Pull-to-bookmark shares these dimensions
  and fill. Keep the marker flat, without shadows or input interception.

### Icon hierarchy — 2026-09-14

Use `GlossaIcons.tsx` for app navigation, reading controls, selection tools and
Glossa workspaces. Draw on a 24-unit grid, with 1.8-unit strokes, round caps and
round joins. Keep most silhouettes within 16–18 units; optically balance open
marks against enclosed shapes. Enclosed frames use 2–3-unit corner radii, small
map junctions 1–1.5 units. Do not round arrow directions or bookmark notches into
unrecognizable shapes. Selected states change the control surface, not glyph size
or stroke weight; a filled bookmark and stop square retain their state meaning.

| Role | Desktop glyph | Control / rounding |
| --- | --- | --- |
| Library toolbar and category navigation | 20px | 32px desktop icon button / 12px; category row keeps its own full-width target |
| Reader header, selection and page navigation | 18px | 32px / 11px; 2px peer gap |
| Left/right pane destinations and collapse | 18px | 32 × 32px target; 28 × 28px selected backplate / 10px; 2px group gap |
| Workspace tools, settings actions, menus, history navigation | 16px | 28px / 9px for pure local actions; menu rows retain their text target |
| Reply actions, fold indicators, selection checks | 14px | 24px / 8px for compact standalone actions; folds/checks keep the parent target |
| Settings category tabs and navigation row chips | 18px | Labeled tabs / 11px; 36px row chip / 12px |
| Image/table viewer controls | 20px | 40px / 12px; 6px group gap and contrasting overlay |
| Alerts, toast status and empty states | 20–32px | Status/illustration role, without an action backplate |
| Standalone account/open-document actions | 20–24px | Keep their full-page row or 44px target |

Sizes live in `glossa.css` (`--glossa-icon-navigation/chrome/tool/detail`);
`glossa-icons.css` maps roles to controls. Use `--glossa-radius-navigation` (12px) for app navigation,
`--glossa-radius-control` (11px) for reading controls,
`--glossa-radius-nested` (9px) for embedded tools and
`--glossa-radius-detail` (8px) for inline actions. Popovers stay
12px, large surfaces 20px, message bubbles and map roots keep their own geometry.
Avoid global `svg` sizing or a blanket radius rule. Import functional glyphs only from `GlossaIcons.tsx`. Its supplement adapts
Lucide secondary glyphs to the same drawing contract; retain Lucide attribution
and license. Do not import raw Lucide or another icon family at call sites.
External service logos, file-format marks, covers and diagrams keep their identity.

Contents uses three chapter markers with long/short/long entry lines, an open
list silhouette that reads at 18px. It is distinct from the split-pane toggles,
bookmarks and branching relationship map. Do not give Contents a notebook frame
or reuse the app logo as a functional icon. Keep tooltips and accessible names;
icons are decorative SVGs inside named controls. Mirror directional controls for
RTL through existing navigation logic, not every icon indiscriminately.

On coarse pointers, role glyphs step up from 18/16/14px to 20/18/16px while
existing per-surface touch targets and reader insets remain authoritative.
Preserve 44px touch regions, focus rings, reduced-motion behavior and explicit
e-ink selection borders. Empty-state symbols (22–28px), the app mark and floating
page controls (24px glyph in a circular target) are intentional exceptions.
This section supersedes earlier icon-size and icon-button radius guidance.


### Reusable icon roles across Glossa — 2026-09-14

This applies to the library and its search/import/transfer tools, reading chrome,
selection and annotation tools, conversation and mind map workspaces, settings,
metadata, dialogs, account controls, alerts and notifications. Coordinate the
whole family while retaining the hierarchy in the table above.

- Draw functional icons through `GlossaIcons`. The reading-specific silhouettes
  remain custom; `GlossaIconsSupplement` normalizes secondary Lucide geometry to
  the same 24-unit grid, 1.8-unit rounded stroke and prop/accessibility contract.
  Extend those two files rather than pasting an SVG or importing another family.
- A glyph has no background. The **control** owns its hit target, surface, radius,
  focus and state. Use `glossa-icon-button` for main actions, add `glossa-tool-icon`
  for nested pure-icon actions, or `glossa-detail-icon` for compact inline actions.
  Use `ReaderPaneTabs` for pane destinations. Do not use an icon-button class on
  a labeled menu row, color swatch, notification symbol or decorative illustration.
- CSS tokens are the reusable source: `--glossa-icon-navigation/chrome/tool/detail`
  = 20/18/16/14px; `--glossa-control-size` = 32px,
  `--glossa-target-tool/detail` = 28/24px. Coarse-pointer controls keep at least
  44px targets, with 20/18/16px chrome/tool/detail glyphs. Main library actions on
  narrow screens retain their existing larger targets. Never reduce reader insets.
- Use 2px between peer reading tools and compact workspace actions; library actions
  keep 4px and distinct groups retain 8px or their semantic separation. Tighten
  icon groups without squeezing text, fields, the progress slider or touch spacing.
- Normal actions use theme ink with a subtle hover wash. Pressed/expanded actions
  keep one stronger ink wash; pane destinations follow the stricter exclusive
  contract below. Disabled controls remain muted and keyboard focus visible.
  Error/warning/success symbols retain their semantic color and shape; do not use
  arbitrary accent colors or filled legacy glyph CSS on a line icon.
- Menus use 16px leading symbols and 14px checks/chevrons, aligned to their text;
  preserve the full row target. Attached search/field controls inherit field
  geometry, with 14–16px glyphs rather than standalone navigation backplates.
- Keep intentional exceptions: circular transport/send/stop controls, circular
  folding counters, native window buttons, filled bookmark/radio/check states,
  battery and scroll indicators, range handles, bookmark ribbons, highlight-style previews, third-party logos,
  file-format marks and empty-state illustrations (cover/profile placeholders may
  remain 48–64px). Tiny noninteractive metadata
  markers may stay 12px. These are documented semantic roles, not accidental sizes.
- E-ink keeps explicit state borders and contrast; reduced motion and e-ink disable
  icon spinners. Directional arrows retain RTL logic; do not mirror all glyphs.
  Visible labels/tooltips and accessible button names describe the action, while
  decorative glyphs default to `aria-hidden`. Never shrink an interactive target
  to an inline glyph's size.
- Custom title-bar dragging must exclude semantic buttons (including their SVG
  children), regardless of their CSS classes. Shared icon buttons must remain
  clickable without triggering window movement.

```tsx
import { Pencil, Copy } from '@/components/GlossaIcons';

<button className='glossa-icon-button glossa-tool-icon' aria-label={_('Edit')}>
  <Pencil />
</button>
<button className='glossa-icon-button glossa-detail-icon' aria-label={_('Copy')}>
  <Copy />
</button>
```

Both examples inherit size, curvature, theme states and touch behavior. Reuse the
role class; avoid copied width/radius utilities that override it. Existing
`glossa-chat-text-button`, `glossa-workmap-icon`, selection tools and library
controls consume the same role tokens. Verify representative navigation, local,
inline and settings controls in light/dark, RTL, narrow and e-ink layouts.

### Pane selection contract — 2026-09-14

Both pane headers use `ReaderPaneTabs` and `glossa-pane-control`. Keep the visual
backplate separate from the hit region: 28 × 28px with 10px corners on desktop and
touch, even when the target grows to 44 × 44px. Only the selected destination gets
the 13% theme-ink wash. Hover changes glyph color only; keyboard focus adds an
outline. E-ink uses a solid selection border. Do not mix these controls with
generic `btn`, pressed/expanded background rules or per-pane selection overrides.

Use this reusable geometry for both pane headers:

| Token in `glossa.css` | Value | Purpose |
| --- | --- | --- |
| `--glossa-control-size` | 32px | Desktop square hit target |
| `--glossa-pane-backplate` | 28px | Centered square selected surface; 2px inset |
| `--glossa-pane-radius` | 10px | Soft, pronounced corners; preserve short straight edges |
| `--glossa-pane-gap` | 2px | Adjacent destinations; 34px center-to-center on desktop |
| `--glossa-pane-group-gap` | 6px | Minimum separation between destinations and collapse |
| `--glossa-pane-inset` | 10px | Pane header edge inset, excluding native window controls |

Keep each destination group together at its leading edge. Search immediately
follows Bookmarks with the same gap; never use auto margins or distributed spacing
between peer tabs. Left collapse precedes its group; right collapse stays at the
trailing edge. Preserve the native macOS traffic-light clearance. Both headers
remain 44px high (48px on coarse pointers); touch targets remain 44px square without
enlarging the backplate. Use the shared component and tokens when adding a pane
destination, not copied button classes or per-icon radii. Glyphs retain their
18px desktop / 20px touch role size and 1.8-unit rounded strokes. Keep other
functional levels on their own geometry; this is not a global radius change.

Contents / Bookmarks / Search are three mutually exclusive destinations, matching
Conversation / Mind map / Notes. Each tablist has exactly one selected tab and one
tab stop; repeated activation keeps that destination open. Opening search through
its tab or a shortcut selects Search immediately, including an empty query.
Switching to Contents or Bookmarks exits search; Escape exits search and restores
the last navigation tab. Preserve the existing saved Contents/Bookmarks preference
and search store instead of persisting Search as a new book setting. Collapse is a
separate action with no persistent selection. Keep tooltip names, panel associations,
RTL-aware arrows and Home/End behavior in the shared component.

### Reading tools — 2026-09-13

Restore Dictionary / Translate / Read Aloud in the selection toolbar and Read Aloud
in the central overflow menu. Keep automatic selection actions opt-in. Use shared
Glossa line icons and paper/ink surfaces; preserve custom toolbar order and spacing.
The speech player is a compact, dismissible strip with play/pause, voice and speed,
above the footer. It must fit a narrow viewport and retain visible keyboard focus.
Dictionary and translation popups keep the selection, support direct close, and use
a single compact header. No promotional cards, teaching text or cloud upsells.
Keep upstream attribution inside Open source licenses and use Glossa for app branding;
external cloud labels remain neutral and their actual destinations remain unchanged.

### Unified reader menu — 2026-09-13

Keep one overflow menu in the central reading header, immediately after Font & Layout.
The navigation sidebar keeps search and its mobile close control without an overflow menu.
It has no persistent book information card; the reading header retains the title.
Book Details in the existing reading menu opens the shared metadata dialog with cover, author
and the current book’s live reading progress.
Book operations share the reading menu and target that header’s book, independently of sidebar state.
Keep bookmark and typography shortcuts directly accessible.

### Glossa visual identity — 2026-09-08

Glossa's library and reader now follow the app icon: two rounded text strokes with a
short interlinear gloss, expressed as ink on paper. This user-requested identity takes
precedence over the upstream Adwaita identity and radius choices below; the existing
interaction, safe-area, RTL, theme and e-ink rules still apply.

- Use the existing Glossa mark (`GlossaMark`) and the shared `GlossaIcons` family in
  the library header, category navigation and reader chrome. All functional icons use the shared family; preserve third-party brand marks. Book cover artwork supplies
  the main color; interface chrome stays neutral.
- Use `glossa.css` theme-derived tokens for ink, muted text, surfaces, borders, focus
  and elevation. The default palette is paper/ink in light mode and charcoal/paper in
  dark mode. Other built-in and custom palettes keep their identity.
- Controls use the role radii above for icons, 12px for standard controls/popovers and
  20px for larger surfaces. Library headings establish hierarchy with type and space;
  book titles and authors remain distinct from reading progress.
- `glossa-icon-button` has a 32px visual size; keep `touch-target` for its existing
  44px hit area. `glossa-button` is the text action; `glossa-button-primary` is the
  monochrome solid action. Use native disabled and pressed/expanded semantics.
- Continue reading is a separate keyboard-navigation region above the main collection.
  Search and card child actions keep their native keyboard behavior. Existing explicit
  recent-shelf preferences remain authoritative; new profiles enable it by default.
- Reader chrome retains its existing dimensions and show/hide behavior, so it does
  not steal space from text or intercept first-line selection. Sidebars use visible
  labels and clear active states. User font, pagination and margin settings are not reset.
- Hover uses short color/border transitions. Reduced-motion and e-ink modes suppress
  decoration; e-ink uses crisp borders and full-contrast text.

### Glossa desktop refinement — 2026-09-09

At widths of 900px and above, use Mac-style desktop chrome: a compact 54px library
toolbar, host system UI typography, a 208px collapsible category sidebar, quiet
neutral controls and rounded list selections. Preserve native traffic lights and
the existing header measurement/drag integration. Do not draw imitation window controls.
The library sidebar navigates existing grouping modes through URL state, retaining
search and view options; it does not change saved grouping preferences. Arrow keys
move focus within the sidebar; activation changes category. The toolbar search uses
the existing configurable Find shortcut. Existing settings and file-opening shortcuts
remain available.

Reader toolbar dimensions stay unchanged so first-line selection and content insets
remain correct. Only app chrome uses the system UI font; book fonts remain user-owned.
Below 900px, retain the compact library layout without the desktop sidebar. Logical
properties support RTL; e-ink retains explicit selection borders and no shadows.

Implementation: `src/styles/glossa.css`, `glossa-library.css`, `glossa-reader.css`,
`glossa-desktop.css`.

### Glossa reading interactions — 2026-09-09

Reading guidance lives in the independent trailing Notebook pane. Use the short
Conversation / Guide / Excerpts tabs and the existing book identity. The guide starts with the local table
of contents; after a chapter choice, offer bounded passages with an original-text
preview. Only an explicit generate action sends the selected passage to the model.
Show a compact orientation and one reading cue; at most two difficulties use native,
initially closed disclosures. Distinguish original claims, interpretations and
minimal background explanations. Sources reveal locally verified text and support
navigation back to the reading position. Keep model setup secondary and preserve
valid results through retryable errors. Closing or switching away cancels work;
there is no automatic next passage, whole-book report, quiz or AI notes version UI.
Use the existing paper/ink tokens, quiet controls and readable spacing. Preserve
keyboard, narrow-screen, RTL, e-ink, source-return and resize behavior.

Conversation (2026-09-12) is a simple API chat using only book title, author and the
current table-of-contents section. Keep a quiet session selector with new/delete
icons, two compact identity lines, an open message list and a fixed bottom composer.
No materials cards, scope controls, evidence badges, summaries, suggestions or
instructional footnotes. Render ordinary safe Markdown with modest paragraph
spacing; keep copy/regenerate actions small and the model name secondary.
The composer's model control opens an inline service/model picker with search,
manual model entry and a settings action. Switching models keeps the conversation.
New conversations isolate history; stopping keeps partial text. Use the shared
paper/ink tokens, 9/12px controls, 16px message/composer rounding, logical spacing,
visible focus and crisp e-ink borders. Bound menus to the viewport and keep the
composer usable in short/narrow panes. See `../../docs/design/conversation.md`.

- Draw core icons on a 24-unit grid with consistent 1.8-unit rounded ink strokes.
  Use open silhouettes and the mark's interlinear rhythm; avoid decorated notebooks,
  starred bookmarks or pictorial empty-state badges. Reuse `GlossaIcons` across
  library, reader, selection tools and sidebars rather than mixing icon libraries.
  Abstract recognizable structures of the named action or content; avoid invented
  physical metaphors that suggest a different object or function.
- One top bar per book: return-to-library and the contents (left sidebar) toggle
  sit at the start as icons. Preserve the original centered plain-text book title,
  without a tab surface, border or rounded frame. Bookmark, reading settings and
  the book-level More menu sit at the end. The assistant toggle sits at the trailing
  edge while closed and moves to the open pane’s trailing edge as its collapse action. Icon buttons
  carry no resting frame: a faint ink wash on hover and a single stronger wash for
  the pressed/expanded state. Inactive selection automation lives under the named
  Selection Actions menu; an enabled action stays visible so the reader can see and
  disable the current mode. Single-book close is available in View Options;
  preserve native window controls.
- The left sidebar holds only in-book navigation — Contents / Bookmarks
  and the current book's search. Cover and author appear only in the Book Details dialog.
  Keep collapse at the far left of its 44px header, followed by Contents / Bookmarks
  icon tabs, with the mutually exclusive Search tab immediately after Bookmarks. Use the shared rounded ink strokes (the
  contents mark uses chapter markers and varying entry lengths on the shared 24px grid), the same selected ink wash
  as the right pane, tooltip names, proper tab/panel semantics and
  arrow/Home/End navigation. Switching is immediate; selecting the current tab
  keeps it open. Selecting Contents or Bookmarks exits search. When closed, its toggle comes before Library
  in the reader bar; when open, the pane owns the sole collapse control. Sidebar pinning is a named menu option, not a permanent
  toolbar icon. The reading-assistant pane uses compact Conversation / Mind map /
  Notes icon tabs (speech, tree, highlight) at the start of its 44px header,
  aligned with the reader bar, and a collapse icon at the trailing edge. Keep
  tooltips, accessible names and arrow/Home/End navigation. Use one ink wash for
  the selected icon, without an underline. Tab-owned actions stay inside each tab;
  there is no pane-level generic menu. Both panels collapse independently,
  remember their widths, dock beside the text on wide windows and become
  dismissible sheets on narrow ones.
- Empty sidebars use a small open icon, short guidance and a secondary action close
  to the content start, without a large centered call to action.
- Group previous/page/next navigation around the progress control. Keep history and
  section jumps secondary. Dragging previews progress locally and release commits
  once; Escape and pointer cancellation restore the original position. Use the same
  behavior on desktop and touch controls, without stealing reader keyboard events.
- Preserve the existing measured header/footer insets and 44px touch regions. User
  fonts, margins, reading position, synchronization and book data remain authoritative.
  Use theme-derived colors, logical directions, visible focus and crisp e-ink states.

### Glossa reading colors — 2026-09-09

Keep the default paper/ink identity. Built-in presets use restrained, low-saturation
light/dark pairs, including a Soft gray preset informed by Dark Reader's
[default background and text colors](https://github.com/darkreader/darkreader/blob/main/src/defaults.ts).
Surface steps stay close in tone; check body, primary and secondary text contrast.
Custom palette generation and existing theme IDs remain compatible.

- Put a reading specimen above the preset grid. Show six common choices first,
  with the remaining built-ins under More colors and saved custom colors below.
  Borrow the app icon's rounded paper shape and generous space: center the text
  specimen on a 20px-radius tile, put the name below, and use one fine outline with
  a small inverse-ink round check for selection. Allow very light paper elevation;
  omit decorative sample rules, preview underlines and section dividers. Use the
  same paper treatment in custom-theme previews. Preserve native radio keyboard
  behavior and isolate reading shortcuts in the settings dialog's capture phase.
- Keep automatic/light/dark appearance separate from the chosen color pair.
  Group book-color override and image inversion in the existing settings primitives.
- Start a custom theme from the current pair, with separate light/dark previews.
  Preserve its ID when renaming; reject conflicting names, and apply saves/deletes
  only after persistence succeeds. Failed actions retain the draft for retry.
- Use logical spacing, two columns in narrow containers and visible focus. E-ink
  uses crisp borders/checks with no shadows or transitions; reduced motion disables
  transitions. Describe colors as preferences, without health claims.

### Reader settings placement — 2026-09-09

All reader settings tabs share the same 440px trailing-edge sheet on viewports
at least 1000px wide and 640px tall, with a transparent overlay and consistent
body padding. Switching tabs must not recenter or resize the dialog. Preserve
RTL mirroring, the narrow-screen dialog and the library settings layout.

### Glossa font controls — 2026-09-09

Use short labels, native buttons and visible font samples. For this user-requested
surface, omit the introductory description required by upstream §2.9; the controls
and preview provide orientation. Keep the paper/ink palette, 12px controls, 9px
segmented buttons, visible keyboard focus and crisp e-ink selection states.

- Open Font directly from the reader's typography button. At desktop widths of
  1000px and heights of 640px or more, place the dialog beside the visible reading
  area without resizing the page; retain the existing modal dismissal behavior.
- Put Book Fonts first in the language-specific font lists, alongside concrete fonts;
  remove the separate Book Fonts / My Fonts switch. Keep size and a continuous weight
  slider (100–1000, step 1) with a numeric stepper in the main view. More contains only
  the monospace font for code reading. Do not restore minimum-size, three weight
  presets, serif/sans category or duplicate face controls. Direct font selection keeps the existing saved family preference; the
  retired minimum-size field stays in legacy records but no longer affects rendering.
  Show the live sample only for custom font selections; Book Fonts are represented by
  the book and have no synthetic sample in the list. Switching to Book Fonts preserves
  the saved custom choices.
- Expand font choices inline, with search, a shared sample and a selected check.
  Escape closes the list before the dialog. Enter commits numeric edits; keep
  arrow-key navigation and 44px touch controls.
- Use `微雨从东来，好风与之俱` for simplified Chinese and
  `Sunt lacrimae rerum et mentem mortalia tangunt.` for Latin scripts. Other scripts
  use short poetic samples; render them through the same font aliases as the reader.
- Preserve the explicit This Book / All Books scope, custom-font management and
  existing settings search links. Changes preview immediately and save in order;
  failed saves expose a concise retry action. Opening unchanged settings does not save.

Readest's UI is **Adwaita-aligned**, **e-ink-first**, **cross-platform-aware**. This doc is the
reference for that language: principles, vocabulary, anti-patterns. New work should read it
before reaching for daisyui defaults; existing work is gradually migrating toward it.

### Status

This doc is the **first articulation** of the system, not a retrospective. Many existing
components don't fully match it yet (especially older buttons and ad-hoc panels). The goal
is that **new code uses these conventions** and **migrations land opportunistically** as
features get touched.

---

### 1. Identity & lineage

Readest's visual language descends from **Adwaita / libadwaita** — GNOME's design system —
adapted for a cross-platform Tauri + Next.js app that also runs on iOS, Android, web, and
e-ink readers.

What we take from Adwaita:

- **Content first, chrome recedes.** The reading surface is the product. Settings, toolbars,
  popups never compete with the page.
- **Boldly minimal.** Restraint over density. Whitespace is structural.
- **Surface hierarchy** — window → view → card — three explicit elevation tiers, no shadow
  gymnastics.
- **Color discipline.** Brand color is rare, reserved for key actions. Neutral palette
  carries the weight.
- **Boxed lists are the chassis.** AdwActionRow's prefix · title · suffix anatomy is the
  canonical settings/list row everywhere.
- **Pills, ghosts, flats.** Three-tier button palette: pill/circular ghost in headers, flat
  secondary over view-bg, accent CTA only when truly primary.
- **Banner vs Toast.** AdwBanner = inline, top-of-window, persistent. AdwToast = transient,
  bottom slide-in.
- **Switches over checkboxes** for boolean settings.
- **Subtle motion.** Short, ease-out, never bouncy.

What's Readest-specific:

- **E-ink as a first-class mode.** Every surface flips to flat 1px contrast borders under
  `[data-eink='true']`. Adwaita is desktop-GNOME-only; we ship to e-ink readers and the
  visual language has to survive there.
- **Cross-platform reality.** Readest runs on macOS, Windows, Linux, iOS, Android, web. The
  identity stays Adwaita; platform grace notes (radii, target sizes) follow host
  conventions where they matter.

---

### 2. Principles

The seven rules. When in doubt, work backward from these.

#### 2.1 Surfaces continue surfaces

A control that extends a list/card should match its parent's border + fill. The
"+ Import Dictionary" button at `src/components/settings/CustomDictionaries.tsx` reads as
detached card siblings of the dictionary list above it because they share
`border-base-200 bg-base-100 rounded-lg`.

> **Bad**: a list of dictionaries in a `bg-base-100` card, followed by a `btn-outline btn-primary`
> add button. The button shouts; the list whispers; the eye bounces.
>
> **Good**: list and add-button share the same surface vocabulary. The eye flows.

#### 2.2 Brand color is reserved for CTAs

Brand `primary` is reserved for true **call-to-action** moments — the actions the product
invites the user to take. A surface's primary action is usually not a CTA: Save, Confirm,
Connect just complete what the user already started, and use the theme-neutral
`btn-contrast` (§4.1) instead of brand color.

- Settings dialog has no primary. Every panel is a list of toggles. **Zero brand color.**
- "Save" in an edit dialog is the surface's primary action, not a CTA. **`btn-contrast`,
  zero brand color.**
- "Import a Book" in onboarding is a true CTA. **One brand color (`btn-primary`).**
- "Add Web Search" extends a list — it's not the surface's primary action. **Neutral.**

#### 2.3 Two-step depth

State changes cycle through **`base-100 → base-200 → base-300`** instead of recoloring.
Hover lifts, active deepens, disabled fades opacity. This is theme-safe (works across all
11 color themes), e-ink-friendly (depth is preserved as borders, not shades), and
calmer than recoloring.

#### 2.4 Localize the hover signal

When a button hovers, **one focal element changes**, not the whole button. The icon chip
inverts; the label stays steady. The badge intensifies; the row stays neutral. This reads
as deliberate, not decorative.

#### 2.5 Motion is color, not transform

Default to `transition-colors duration-150`. No `scale`, no `translate`, no `rotate` unless
the motion **is** the message (a chevron rotating to indicate expansion is fine; a button
that scales on hover is not). Transforms break under `[data-eink='true']` and feel
gimmicky under Adwaita's calm rhythm.

#### 2.6 Eink-first by default

Every custom-styled bordered surface gets the `eink-bordered` class. Every primary action
gets `btn-contrast` (already e-ink-correct) or, for true CTAs, `btn-primary` (which has
dedicated eink rules). Don't rely on color or shadow alone for hierarchy — eink screens
have neither.

If you can't toggle Settings → Misc → Eink and still tell which button is the CTA, the
hierarchy is broken.

#### 2.7 Focus is visible but quiet

Keyboard focus needs a visible ring. `focus-visible:ring-2 focus-visible:ring-base-content/15`
is the canonical treatment for custom buttons. Loud `ring-primary` reserved for inputs
where the focus state IS the affordance.

#### 2.8 RTL: always use logical properties (REQUIRED)

Readest ships with RTL languages enabled. **Never use direction-bound Tailwind
utilities** when a logical equivalent exists — the visual edges flip in RTL,
the logical ones don't.

| Don't use                          | Use instead                        |
| ---------------------------------- | ---------------------------------- |
| `pl-*` / `pr-*`                    | `ps-*` (start) / `pe-*` (end)      |
| `ml-*` / `mr-*`                    | `ms-*` / `me-*`                    |
| `text-left` / `text-right`         | `text-start` / `text-end`          |
| `border-l` / `border-r`            | `border-s` / `border-e`            |
| `rounded-l-*` / `rounded-r-*`      | `rounded-s-*` / `rounded-e-*`      |
| `left-*` / `right-*` (positioning) | `start-*` / `end-*`                |
| `justify-start` / `justify-end`    | (these ARE direction-aware) — keep |

The `flex-row` direction is automatically reversed in RTL by the browser, so
you usually don't need to do anything for `flex` / `gap`. Only **explicit
edges** (padding, margin, borders, radius, absolute positioning) need
logical properties.

**Quick scan when reviewing a diff:** grep for `\b(pl|pr|ml|mr|left-|right-|text-left|text-right|border-l|border-r|rounded-l|rounded-r)-` in changed files. Any hit that isn't a deliberate LTR-only
case (rare — usually only icon glyphs that have a fixed orientation) should
be flipped to the logical equivalent.

#### 2.9 Every panel and sub-page starts with title + description (REQUIRED)

Every settings panel and every sub-page must open with:

1. **A title** — the panel name. Style: `text-lg font-semibold tracking-tight`. In a
   top-level panel this is an `<h2>`; in a sub-page this is the `parentLabel /
currentLabel` breadcrumb in `SubPageHeader` (which uses the same typography so the
   word stays anchored visually as the user navigates in/out).
2. **A one-line description** — a short sentence under the title explaining what this
   surface does or how it fits in the user's workflow. Style: `text-sm
text-base-content/70 leading-relaxed`. Skip it only when the surface is so trivial
   the breadcrumb already says everything (rare — when in doubt, write one).

Why: orientation, visual rhythm, and Adwaita parity (`AdwPreferencesPage` always has
both). The same vertical opening across every surface makes the system feel cohesive
and gives users a predictable place to learn what a screen does.

**Canonical components.** The `<SubPageHeader>` primitive in
`src/components/settings/SubPageHeader.tsx` accepts a `description?: React.ReactNode`
prop that renders the description in the canonical style — sub-pages should pass it
there rather than rolling their own `<p>` below the header. Top-level panels currently
inline the title + description; if a third or fourth panel needs the same pattern,
extract a `<PanelHeader>` primitive following the same shape.

**Examples.**

```tsx
// Sub-page (Integrations → OPDS Catalogs)
<SubPageHeader
  parentLabel={_('Integrations')}
  currentLabel={_('OPDS Catalogs')}
  description={_('Browse and download books from online catalogs')}
  onBack={() => setSubPage(null)}
/>

// Top-level panel (Integrations panel root)
<div className='w-full'>
  <h2 className='mb-1.5 text-lg font-semibold tracking-tight'>{_('Integrations')}</h2>
  <p className='text-base-content/70 text-sm leading-relaxed'>
    {_('Connect Readest to external services for sync, highlights, and catalogs.')}
  </p>
</div>
```

---

### 3. Surface hierarchy

Three named tiers, mapped onto daisyui tokens. Use these terms in conversation and code
comments even though the classes are still daisyui-native.

| Tier       | Token                                | Role                                                                          | Example                                         |
| ---------- | ------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------- |
| **Window** | `bg-base-200`                        | The outermost backdrop. Modal scrims, dialog content area, scroll containers. | `<Dialog>` body                                 |
| **View**   | `bg-base-100/60` or `bg-base-200/40` | Mid-tier surface inside a window. Tip boxes, secondary panels.                | The "提示 / Tips" callout in CustomDictionaries |
| **Card**   | `bg-base-100`                        | Top-tier content surface. Boxed lists, popovers, modal-box.                   | The dictionaries list card                      |

Border treatment:

- **Window** has no border (it IS the boundary).
- **View** uses no border or `border-base-200/60` for very soft delineation.
- **Card** uses `border border-base-200`. In e-ink, `eink-bordered` flips it to 1px
  `border-base-content`.

Corner radius:

- **Card / View**: `rounded-lg` (8px) — Readest's house radius. Adwaita uses 9px; 8px is
  close enough and matches Tailwind's scale.
- **Modal / Sheet**: `modal-box` default (~1rem / 16px) — bigger surfaces get bigger radii.
- **Pills / Chips**: `rounded-full`.
- **Inputs / small buttons**: `rounded-md` (6px) or `rounded-lg` (8px).

#### Surface continuity rule

When a control extends a card (an "add row" affordance, a footer button bar attached to a
list), it inherits the card's surface treatment: same `bg-base-100`, same
`border-base-200`, same `rounded-lg`. It is the card grown by one row.

---

### 4. Action vocabulary

Seven archetypes. Pick by **role**, not by **appearance**.

#### 4.1 Contrast primary

The default solid primary button: theme-neutral `base-content` background with a
`base-100` label (`.btn-contrast` in `globals.css`). Use it for the primary action of a
surface — Save, Confirm, Connect, Apply, dialog submits. **Most primary buttons should
be this archetype**, not `btn-primary`.

```tsx
className = 'btn btn-contrast';
```

It carries clear weight without spending brand color, fits the minimalist themes, and is
already e-ink-correct (a solid `base-content` fill needs no inversion).

> **Why changed (Jul 2026):** `btn-primary` used to be the blanket "primary action"
> class. Primary actions now default to `btn-contrast` so brand color stays reserved
> for true call-to-action moments (§2.2).

#### 4.2 Accent CTA

The brand-colored button. Reserved for true **call-to-action** moments — actions the
product invites the user to take: "Sign In", "Import a Book" in onboarding, upgrade
prompts. **One per surface, max**, and most surfaces have none — if the button merely
completes what the user already started, use `btn-contrast` (§4.1).

```tsx
className = 'btn btn-primary';
```

Eink: `btn-primary` has dedicated rules (inverts to base-content bg + base-100 text) so it
stays distinct from secondary actions on monochrome screens.

#### 4.3 Suggested

A non-accent-but-emphasized action. Used when there are multiple equally-weighted actions
and one is the recommended path. Adwaita's "suggested-action" CSS class.

```tsx
className = 'btn btn-neutral';
```

Rare. Most surfaces don't need this tier.

#### 4.4 Flat

The default secondary button. Sits on a view or card surface, no border, hover lifts to
`base-200`. The bulk of buttons should be flat.

```tsx
className="btn btn-ghost"
// or for a custom surface treatment:
className={clsx(
  'rounded-lg px-4 py-2 text-sm font-medium',
  'hover:bg-base-200 transition-colors duration-150',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-base-content/15',
)}
```

#### 4.5 Pill / Circular ghost

Compact icon-only buttons in header bars and toolbars. Always `rounded-full`,
`btn-circle` or hand-rolled circular ghost.

```tsx
className = 'btn btn-ghost btn-circle h-8 min-h-8 w-8 p-0';
```

The window controls in `SettingsDialog.tsx` (search, menu, close) use this archetype.

#### 4.6 Destructive

Delete, remove, irreversible. Adwaita uses `destructive-action`. Readest uses red
sparingly — usually only the icon, not the whole button.

```tsx
// Icon-only delete X in delete mode:
className = 'btn btn-ghost btn-sm shrink-0 px-1';
// with <IoMdCloseCircleOutline className="text-error h-4 w-4" />
```

For destructive **dialogs** (confirmation modals), the confirm button can be `btn-error`,
but only in the modal — never on the main surface.

#### 4.7 ListExtension

A Readest-named archetype for "add another row to the list above" affordances. The two
buttons at the bottom of `CustomDictionaries.tsx` are the canonical example.

Anatomy:

- Surface matches the parent card (`border border-base-200 bg-base-100 rounded-lg`)
- Height ~h-11
- Centered: small icon chip + label
- Icon chip: `bg-base-200 text-base-content/60 rounded-full h-5 w-5`
- Hover: border deepens to `base-300`, bg lightens to `bg-base-200/60`, icon chip inverts
  to `bg-base-content text-base-100`
- `eink-bordered` on the button itself

```tsx
<button
  type='button'
  onClick={handleAdd}
  className={clsx(
    'eink-bordered group flex h-11 items-center justify-center gap-2.5',
    'border-base-200 bg-base-100 rounded-lg border px-4',
    'text-base-content text-sm font-medium',
    'transition-colors duration-150',
    'hover:border-base-300 hover:bg-base-200/60',
    'active:bg-base-200/80',
    'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
  )}
>
  <span
    className={clsx(
      'flex h-5 w-5 items-center justify-center rounded-full',
      'bg-base-200 text-base-content/60',
      'transition-colors duration-150',
      'group-hover:bg-base-content group-hover:text-base-100',
    )}
  >
    <MdAdd className='h-3.5 w-3.5' />
  </span>
  <span className='line-clamp-1'>{label}</span>
</button>
```

Use this for: "Import Dictionary", "Add Web Search", "Add Custom Theme", any "+ add new
to this list" pattern. **Do not** use `btn-outline btn-primary` for these.

---

### 5. Boxed list anatomy

The settings UI is built on boxed lists. One pattern, used everywhere.

#### Container

Use the `<BoxedList>` primitive at `src/components/settings/primitives/BoxedList.tsx`
rather than inlining the chassis classes:

```tsx
<BoxedList title={_('Reading Sync')} data-setting-id='settings.section.id'>
  {/* rows */}
</BoxedList>
```

The primitive renders:

```tsx
<div className='card eink-bordered glossa-group-card rounded-xl'>
  <div className='glossa-group ps-4'>{children}</div>
</div>
```

- `card` for the flex-column chassis
- `rounded-xl` for the 12px radius, matching `--glossa-radius`
- `glossa-group-card` for the faint raised fill (`base-200` lifted ~4% toward
  white via `--glossa-group`) — **no outline in normal mode**
- `eink-bordered` for the e-ink-mode contrast border
- `glossa-group ps-4` for the text-aligned hairline separators: a 1px rule at
  9% ink that starts at the 16px text column (`inset-inline-start: 16px`), not
  the card edge

> **No `overflow-hidden` on the card.** Children may host popovers (color
> pickers, dropdowns, tooltips) that need to escape the card bounds. The
> `divide-y` rules sit between rows and don't touch the card's rounded
> corners, so omitting overflow-clip is visually safe AND keeps embedded
> popovers from getting clipped.

#### Row anatomy

Three slots, in order, always:

```
┌─────────────────────────────────────────────────────────────────┐
│ [prefix]   Title text                          [suffix slots]   │
│ [        ] Subtitle text (optional)            [       ][      ]│
└─────────────────────────────────────────────────────────────────┘
```

| Slot         | Contents                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------- |
| **Prefix**   | Drag handle, leading icon, avatar, status dot, or empty.                                          |
| **Title**    | Primary label. `font-medium`. Truncates with `truncate`.                                          |
| **Subtitle** | Optional secondary line. `text-sm text-base-content/70`. Used for warnings, descriptions, status. |
| **Suffix**   | Badge, switch, button, chevron, value, or any combination. End-aligned.                           |

Canonical example: `SortableRow` in `src/components/settings/CustomDictionaries.tsx`. The
drag handle is the prefix, the dict name is the title, the warning reason is the
subtitle, and the badge + toggle + edit/delete buttons stack as suffixes.

#### Row variants

- **ActionRow** — title + suffix is a single button or chevron. Tap anywhere navigates.
- **SwitchRow** — title + suffix is a toggle. Tap anywhere toggles.
- **ComboRow** — title + suffix is a dropdown/select.
- **ExpanderRow** — chevron suffix; tap expands to reveal nested rows.

These names come from libadwaita and apply 1:1 to Readest's lists. Use the names in code
comments and PR descriptions.

#### Spacing

- Row vertical padding: `py-2` (8px) for compact lists, `py-3` (12px) for breathing room.
- Row horizontal padding: `px-3` (12px) or `px-4` (16px). Stay consistent within a list.
- Slot gap: `gap-2` (8px) between prefix/title/suffix elements.

#### Disabled rows

Disabled rows fade the title to `text-base-content/60` and disable the suffix control. The
row itself stays at full opacity — only the **content** dims, not the row.

#### Toggle size

| Daisyui class                   | Use case                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `toggle` (default, h-5 / ~20px) | **Settings panel boxed-list rows** — `<SettingsSwitchRow>` uses this. Visible weight matches the 56px `min-h-14` row. |
| `toggle-sm` (h-4 / ~16px)       | Inline secondary switches in tighter contexts — e.g. dictionary list rows in `CustomDictionaries`.                    |
| `toggle-xs` (h-3 / ~12px)       | Compact metadata toggles inside cards — e.g. OPDS catalog "Auto-download".                                            |

The `<SettingsSwitchRow>` primitive bakes in the default `toggle`. **Don't override
to `toggle-sm` inside boxed-list rows** — it looks orphaned in the row's vertical
breathing room. Use the smaller sizes only when the row itself is shorter than 56px.

#### Typography inherits from `.settings-content`

The Settings dialog (and any settings-style sheet/popup) wraps its content
in `.settings-content`, which is defined in `src/styles/globals.css` as:

```css
.dropdown-content,
.settings-content {
  font-size: 14px; /* desktop */
}
@media (max-width: 768px) {
  .dropdown-content,
  .settings-content {
    font-size: 16px; /* mobile bump — high-DPI phones need bigger body text */
  }
}
```

**Don't hardcode `text-sm` on row labels, NavigationRow titles, or panel
descriptions** — that locks the text to 14px on every viewport and kills
the mobile bump. Instead:

- **Primary labels** (SettingsRow label, NavigationRow title, SubPageHeader
  description, ad-hoc row labels in panels and integration forms): no
  font-size class — inherits 14/16 from the wrapper. Use `<SettingLabel>`
  rather than inlining a `<span>`; it adds `font-medium` for cased scripts
  and drops the weight for caseless scripts (CJK / Arabic / Hebrew / Indic
  / Thai / Tibetan), since those bold poorly at body size and `font-medium`
  on Han / Hangul / Devanagari renders as uneven stroke-thickening across
  system fonts.
- **Secondary text** (SettingsRow description, NavigationRow status, Tips
  body, BoxedList description): use `text-[0.85em]` so it stays
  proportional (≈12px desktop, ≈13.6px mobile). A **`SettingsRow`
  description is clamped to a single line** (`line-clamp-1`, ellipsis on
  overflow) by the primitive — keep it short enough to read on one line at
  mobile width; it is a hint, not a paragraph. Move anything longer into a
  `<Tips>` block below the list.
- **Form controls** (`<input>`, `<select>`): browsers don't inherit
  font-size onto form elements, so add the `settings-content` class
  _directly on the element_ to re-apply the 14/16 cascade. The legacy
  NumberInput already does this — match its pattern.
- **Section headers** (`BoxedList` uppercase title): use `text-[0.85em]
font-semibold uppercase tracking-wider`. The em-relative size keeps it
  proportional with the `.settings-content` cascade. **Caseless-script
  exception:** when `isCaselessUILang()` is true, bump to `text-[1em]`.
  The `uppercase` rule is a no-op in scripts without case (CJK, Arabic,
  Hebrew, Devanagari/Bengali/Tamil/Sinhala, Thai, Tibetan), so the size
  has to carry the emphasis those scripts can't pick up from casing. The
  helper lives in `src/utils/misc.ts`; the underlying `isCaselessLang`
  predicate lists every covered language code in `src/utils/lang.ts`.

Why this matters: Tailwind's `text-xs` / `text-sm` are rem-based — they
ignore the parent's `font-size` because rem is rooted at the document.
The `.settings-content` cascade is in `px`, so any child that picks a
Tailwind size literally tunes itself to the desktop default and never
grows on mobile. iOS and Android have small physical screens but high
DPI, so the mobile bump is what makes the text legible at typical reading
distance.

#### Uniform row height

Settings rows in a boxed list MUST all be the same visual height. Use
`min-h-14 items-center` (56px) on each row container — toggle, select, and
input rows then center their controls vertically inside identical boxes.
**Don't use `py-3`** — content-driven padding produces uneven heights
because toggles, selects (`h-9`), and inputs (`h-9`) have different
intrinsic sizes.

```tsx
// ✓ Right — no text-sm; label inherits .settings-content (14/16)
<label className='flex min-h-14 items-center justify-between px-4'>
  <span className='font-medium'>{_('Sync Enabled')}</span>
  <input type='checkbox' className='toggle' ... />
</label>

// ✗ Wrong — toggle row will be 48px, select rows 60px
<label className='flex items-center justify-between px-4 py-3'>...</label>

// ✗ Wrong — text-sm hardcodes 14px even on mobile (kills the bump)
<span className='text-sm font-medium'>{_('Sync Enabled')}</span>
```

#### Controls inside a boxed list have no chrome

When a control sits inside a bordered card, it shouldn't carry its own
border or fill. The card supplies the visual boundary; the control just
sits on the row.

- **Selects:** drop `select-bordered` and `eink-bordered`. Add
  `!bg-transparent !bg-none !appearance-none` to suppress daisyui's
  background chevron and native arrow. Render a real `<MdArrowDropDown>`
  icon at the cell's trailing edge for the affordance — see "End-aligned
  values" below.
- **Inputs:** drop `input-bordered` and `eink-bordered`. Add `!bg-transparent`
  with `hover:!bg-base-200/60 focus:!bg-base-200/60` so the field still
  signals interactability. Use `text-end` and `!pe-0` so the value sits
  flush against the row's trailing edge.
- **Toggles:** untouched — they're already chromeless.

This is the iOS Settings / Adwaita PreferencesGroup convention: list
chrome belongs to the container, not its children.

#### End-aligned values + chevron alignment

The selected value of a select/input MUST end-align (`text-end`). The
**visible right edge** of every row's value (toggle, chevron icon, input
text) MUST land at the same X — the row's trailing padding.

The trap: daisyui's select renders its chevron via background-image at
`calc(100% - 1rem) center`, which floats the glyph 16px _inside_ the
select's right edge. So if the toggle in row 1 ends at the row's `pe-4`
edge, the chevron in row 2 ends 16px before that — visibly misaligned.

**Fix:** suppress daisyui's bg-image chevron and render an explicit icon at
the cell's trailing edge. The select's own daisyui focus chrome (outline +
box-shadow + ring) is suppressed; **no focus ring** on controls inside the
boxed list — focus state is signaled by a subtle wrapper bg-shift instead
(hover and focus-within both lift to `bg-base-200/60`). Rings would compete
with the card's own border and double-stack with adjacent rows.

Use `SettingsSelect` and `SettingsInput` rather than copying their underlying
classes. They share 36px desktop / 44px touch height, transparent resting surfaces,
logical trailing alignment, and an explicit keyboard outline. The select wrapper
owns its outline so the chevron is included; the text input draws its own. The
previous no-ring/background-shift-only rule is superseded by the 2026-09-14
interface foundations above.

---

### 6. Header bars, dialogs, popups, sheets

#### Header bar

The dialog/page header. Adwaita's AdwHeaderBar.

- **48–56px tall** (`h-12` to `h-14`).
- **Center-aligned title** in `font-semibold text-base`.
- **Leading slot**: back chevron (mobile) or empty (desktop).
- **Trailing slot**: window controls — search (pill ghost), menu (pill ghost),
  close (pill ghost circle with `bg-base-300/65`).
- No bottom border; rely on tab/divider that follows.

`SettingsDialog.tsx`'s mobile header is the canonical example. The desktop header is
slightly different — tabs sit in the same row as window controls, no center title — but
it's the same archetype adapted for screen real estate.

#### Dialog (modal)

```tsx
<Dialog
  isOpen={...}
  onClose={...}
  boxClassName="sm:min-w-[520px] overflow-hidden"
  header={<HeaderBar />}
>
  {/* content */}
</Dialog>
```

- `modal-box` provides the radius, max-width, and shadow (auto-removed in eink).
- Width ~520px on desktop, full-width on mobile.
- Bottom sheets on mobile via `snapHeight` prop.
- Backdrop: `sm:!bg-black/50` (or `/20` when nested over a darker surface).

#### Popup (popover)

For dictionary lookups, annotation editors, and other anchored overlays. Uses the
`Popup` component with a triangle pointer.

- **Width**: clamp to fit content; ~320–420px typical.
- **Surface**: `bg-base-100`, `rounded-lg`, soft shadow (eink removes shadow).
- **Triangle**: pointer toward the anchor; eink has special triangle classes.
- **Padding**: `p-3` to `p-4` for content.

#### Sheet (mobile bottom)

Reserved for mobile contextual menus and full-screen secondary panels. Uses the dialog's
`snapHeight` prop. Adwaita doesn't have a native sheet but Readest's mobile pattern is
the closest analog.

- Always full-width.
- Top corners rounded; bottom corners flat (it's anchored to the bottom).
- Drag handle at top (the small horizontal pill) is mandatory if the sheet supports
  swipe-to-dismiss.

#### Stacking order (z-index scale)

Full-screen and body-portaled overlays share **one global stacking scale**. Keep it
compact — never reach for four-digit z-indexes. Every layer must clear the desktop
rounded-window page frame (`.window-border`, `z-99` in `globals.css`), then layer:

| z-index | Layer | Where |
| ------- | ----- | ----- |
| `99` | Desktop window-border page frame | `globals.css` |
| `100` | RSVP immersive reading overlay | `RSVPOverlay` |
| `101` | RSVP immersive controls (start dialog, lookup chip) | `RSVPStartDialog`, `RSVPOverlay` |
| `110` | Settings app dialog (above RSVP for in-overlay dictionary mgmt) | `SettingsDialog` |
| `120` | Modal / command palette | `ModalPortal`, `CommandPalette` |
| `130` | Toast / alert | `Alert` |
| `200` | Security lock screen | `AppLockScreen` |

The non-obvious invariant: **`ModalPortal` (120) must stay above `SettingsDialog`
(110)** so a modal opened _from inside_ Settings (e.g. Add OPDS Catalog) isn't buried.
This bites only on mobile — desktop traps `SettingsDialog` inside the `z-99`
`.window-border` stacking context, so the body-portaled modal already wins there.
The ordering is locked by `src/__tests__/styles/zIndexScale.test.ts`; update both
together.

---

### 7. Motion + a11y

#### Motion

- Default duration: **150ms** for color transitions.
- Default easing: browser default (`ease`) or `ease-out`. Never `ease-in`.
- Longer transitions (300ms+) only for layout changes (sheet snap, panel slide).
- **Never** use `transform` for hover unless the transform IS the message
  (chevron rotation, drag-handle drag visualization). E-ink doesn't render mid-transitions
  cleanly and Adwaita's identity is calm.

```tsx
// Good — hover:bg-base-200 with transition-colors
className = 'transition-colors duration-150 hover:bg-base-200';

// Bad — scale on hover
className = 'transition-transform hover:scale-105';
```

Existing exceptions: `.window-button` in globals.css uses `hover:scale-105`. That's
legacy; new code shouldn't follow it.

#### Reduced motion

Reduced-motion preference is honored via the `no-transitions` class
(`globals.css:624`). Layout-changing transitions should respect
`prefers-reduced-motion: reduce` either via this class or `motion-safe:` Tailwind
prefixes.

#### Focus

- Every focusable element must have a visible focus indicator.
- Custom buttons:
  `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-base-content/15`.
- Inputs: rely on daisyui's input focus ring; inputs with custom styling use
  `focus:ring-2 focus:ring-primary/40`.
- Don't use `outline-none` without `focus-visible:` replacement.

#### Hit targets

- **Minimum**: 32px (the size of `btn-sm`).
- **Recommended**: 40px (`btn`) on touch surfaces.
- **Mobile**: 44px+ for taps that aren't fail-safe (delete, navigate-away).
- The `touch-target` class in globals.css extends a small visual control's hit area to
  44px without changing its rendered size — use it on icon-sized buttons in mobile UIs.

#### Color contrast

- Body text on background: WCAG AA (4.5:1) minimum.
- Large text: WCAG AA Large (3:1) minimum.
- Interactive text on hover state: still passes contrast on the new background.
- Theme palette is generated from `(bg, fg, primary)`; the tinycolor pipeline keeps
  contrast within range, but custom themes can break this — Settings → Color flags
  low-contrast custom themes.

#### Keyboard

- Tab order matches visual order. If you use `flex-row-reverse` for visual layout,
  consider `tabIndex` to fix order.
- Modal focus trap: `<Dialog>` handles this.
- Esc to dismiss: `<Dialog>` and `<Popup>` handle this.
- Arrow keys for grouped controls (radio-like tab strips, sortable lists). dnd-kit's
  `KeyboardSensor` is wired for sortable lists.

---

### 8. E-ink overlay (cross-cutting)

E-ink mode is toggled by `[data-eink='true']` on the document. It applies a global
override layer in `src/styles/globals.css:484-622` that:

- Removes all `box-shadow`.
- Forces `text-base-content`, `text-blue-*`, `text-red-*`, `text-neutral-content` to a
  single foreground color.
- Inverts `btn-primary` and `btn-outline` to base-content bg + base-100 text
  (`btn-contrast` already renders this way in every mode).
- Adds 1px contrast borders to `.eink-bordered`, `.modal-box`, `.menu-container`,
  `.popup-container`, `.alert`, `.opds-navigation .card`, `.booknote-item`,
  `.bookitem-main`.

What this means for new components:

| Surface type                         | Required class          | Why                                                           |
| ------------------------------------ | ----------------------- | ------------------------------------------------------------- |
| Custom bordered button or input      | `eink-bordered`         | Gets the 1px contrast border in eink                          |
| Primary action (default)             | `btn-contrast`          | Solid base-content fill is already e-ink-correct              |
| Accent CTA                           | `btn-primary`           | Picks up the inverted treatment                               |
| Cancel / secondary action            | `btn-ghost` (no border) | Reads as "outlined" only after pairing with the CTA           |
| Card / panel using `border-base-200` | `eink-bordered`         | Otherwise the soft border vanishes in eink                    |
| Modal / Popup                        | (auto)                  | `modal-box` and `.popup-container` are handled in globals.css |

Verification checklist before shipping a new UI:

- [ ] Toggle Settings → Misc → Eink mode and re-test every screen.
- [ ] Every container that has a soft border (`border-base-200`) still has visible
      delineation.
- [ ] Every CTA is distinguishable from its neighbors (cancel, secondary).
- [ ] No hover transforms make the UI feel jumpy.
- [ ] Text is fully opaque (no `text-base-content/60` content; eink can't render the
      reduced opacity well).

#### What's NOT compatible with e-ink

- Drop shadows for hierarchy (use borders).
- Color-only state changes (use border weight or fill swap).
- Hover scale / translate (they look broken on slow refresh).
- Animations longer than ~200ms (visible refresh artifacts).

---

### 9. Cross-platform grace notes

Readest ships on **macOS, Windows, Linux, iOS, Android, web**. Adwaita is desktop-GNOME-
native; we adapt where the host OS has strong conventions, but never at the cost of
identity.

#### iOS

- Slightly larger corner radii feel native (`rounded-xl` on dialogs, `rounded-lg` on
  cards).
- Safe area insets are mandatory for top + bottom anchored elements (see
  `docs/safe-area-insets.md`).
- Avoid Material Design ripple effects.
- Sheet-style modals (bottom-anchored) match iOS conventions and are preferred over
  centered dialogs on phone-sized screens.

#### Android

- Material 3 conventions that conflict with Adwaita (FABs, elevation shadows, ripple
  inks): **don't** copy them. Readest's identity is Adwaita; the user is reading on
  Android, not in Android.
- Touch targets bumped to 48px for primary actions (Material's recommended target).
- Back-gesture-aware UIs: ensure swipe-from-edge doesn't conflict with horizontal swipe
  controls.

#### Linux

- Native Adwaita territory. Readest can match host theme for window chrome (Tauri
  decorations) but should keep its own internal palette for the reading surface — book
  themes (sepia, gruvbox, etc.) are user choices, not OS choices.

#### macOS / Windows

- Window controls (close/minimize/maximize) are platform-native via Tauri.
- Title bar height matches platform convention; internal layout follows Readest's
  Adwaita palette.

#### Web

- No safe-area insets needed.
- Keyboard shortcuts are doubled with command-palette discoverability (Cmd/Ctrl+K).
- Browser-native focus rings: respected, augmented with `focus-visible:ring-*`.

#### E-ink readers (Android-based, custom firmware)

- Detected via the eink mode toggle (Settings → Misc).
- All rules in §8 apply.
- This is a **first-class** target, not a fallback.

---

### 10. Anti-patterns

Things that LOOK fine in isolation but break the system. Each one has a real source diff
or commit reference.

#### 10.1 Loud outlined CTAs for non-primary actions

```tsx
// Anti-pattern (was in CustomDictionaries.tsx, fixed Nov 2026):
<button className='btn btn-outline btn-primary gap-2 normal-case [--animation-btn:0s]'>
  <MdAdd className='h-5 w-5' />
  Import Dictionary
</button>

// Correct: ListExtension archetype (see §4.7)
```

Why it broke: the buttons read as primary CTAs but are list extensions. They competed
with the active settings tab indicator and pulled the eye from the list itself.

#### 10.2 Recoloring the whole button on hover

```tsx
// Anti-pattern:
<button className="text-base-content/70 hover:text-base-content hover:bg-primary/10">

// Correct: keep the label color steady, hover via bg shift on the surface
<button className="text-base-content hover:bg-base-200 transition-colors">
```

Why: principle 2.4 (localize the hover signal). Whole-button color shifts feel decorative.

#### 10.3 Transform-based hover

```tsx
// Anti-pattern:
<button className="hover:scale-105 transition-transform">

// Correct: color/border-based hover
<button className="hover:bg-base-200 hover:border-base-300 transition-colors">
```

Why: breaks under e-ink (§2.5), feels jumpy under Adwaita's calm rhythm.

#### 10.4 Soft borders without `eink-bordered`

```tsx
// Anti-pattern:
<div className="border border-base-200 bg-base-100 rounded-lg p-4">
  ...
</div>

// Correct:
<div className="eink-bordered border border-base-200 bg-base-100 rounded-lg p-4">
  ...
</div>
```

Why: in e-ink mode, `base-200` borders disappear into the background. `eink-bordered`
flips the border to `base-content` so the boundary stays visible.

Exception: containers that **don't** need a visible boundary in eink (e.g., a
`bg-base-100` surface that's already against `bg-base-200`) can skip `eink-bordered`.
The class is opt-in for "this surface needs a border to read correctly".

#### 10.5 Reduced-opacity text in e-ink

```tsx
// Anti-pattern (in eink):
<span className="text-base-content/50">Optional metadata</span>

// Correct (still readable in eink):
<span className="text-base-content text-xs">Optional metadata</span>
// Or use semantic muting that the eink overlay handles:
<span className="text-neutral-content">Optional metadata</span>
```

Why: e-ink's reduced color depth turns `/50` opacity into illegible mush. Use size or
weight for hierarchy on muted secondary text.

#### 10.6 Daisyui `btn` defaults without intent

```tsx
// Anti-pattern: just reaching for `btn` with no role:
<button className="btn">Click me</button>

// Correct: pick an archetype from §4.
<button className="btn btn-ghost">Cancel</button>      // Flat
<button className="btn btn-contrast">Save</button>     // Contrast primary
<button className="btn btn-primary">Sign In</button>   // Accent CTA (true CTAs only)
```

Why: daisyui's `btn` default isn't tuned for any specific role. Pick from the action
vocabulary so the button signals its weight in the surface hierarchy.

#### 10.7 Ad-hoc surface tokens

```tsx
// Anti-pattern:
<div className="bg-white border-gray-200">

// Correct:
<div className="bg-base-100 border-base-200">
```

Why: hard-coded colors don't theme. Readest has 11 themes plus user-defined custom themes.
Always use the daisyui semantic tokens.

#### 10.8 Mixing `btn` sizes within a surface

```tsx
// Anti-pattern:
<header>
  <button className="btn btn-sm">Search</button>
  <button className="btn btn-md">Settings</button>
  <button className="btn btn-xs">Close</button>
</header>

// Correct: one size per surface
<header>
  <button className="btn btn-ghost btn-circle h-8 min-h-8 w-8">Search</button>
  <button className="btn btn-ghost btn-circle h-8 min-h-8 w-8">Settings</button>
  <button className="btn btn-ghost btn-circle h-8 min-h-8 w-8">Close</button>
</header>
```

Why: visual rhythm. Mixed sizes feel like the surface is unfinished.

---

### 11. Quick reference

When designing a new surface, walk this checklist:

1. **What's the surface tier?** Window / View / Card. (§3)
2. **What's the corner radius?** Match the tier. (§3)
3. **Is there a primary action?** If yes, ONE solid primary — `btn-contrast` by default,
   `btn-primary` only for a true CTA. If no, all flats. (§4.1, §4.2, §4.4)
4. **Are there list extensions?** Use the ListExtension archetype, not `btn-outline btn-primary`. (§4.7)
5. **Is it a list?** Use the BoxedList chassis with ActionRow / SwitchRow / ComboRow / ExpanderRow rows. (§5)
6. **Does it need `eink-bordered`?** If it has a soft border that must stay visible in
   eink mode, yes. (§8)
7. **Is the hover signal localized?** One focal element changes, not the whole control. (§2.4)
8. **Is motion color-only?** No transforms unless the transform IS the message. (§2.5)
9. **Is focus visible?** `focus-visible:ring-2 focus-visible:ring-base-content/15` on
   custom buttons. (§7)
10. **Will it work on the smallest theme + e-ink?** Toggle Sepia + Eink, retest.

---

### 12. Glossary

- **Adwaita / libadwaita**: GNOME's design system and widget toolkit. Source of Readest's
  visual lineage.
- **AdwActionRow / AdwSwitchRow / AdwComboRow / AdwExpanderRow**: libadwaita's row
  primitives. Readest mirrors these conceptually with custom React components.
- **AdwBoxedList**: libadwaita's named container for grouped action rows.
- **AdwBanner**: top-of-window inline alert (persistent).
- **AdwToast**: bottom slide-in transient alert.
- **Window / View / Card**: surface tiers (§3).
- **btn-contrast**: theme-neutral solid primary button (`base-content` bg, `base-100`
  label) defined in `globals.css`; the default for surface-primary actions (§4.1).
- **ListExtension**: Readest-named archetype for "+ add new row" buttons (§4.7).
- **eink-bordered**: utility class in `globals.css` that gives a surface its e-ink-mode
  contrast border. Opt-in.
- **Pill ghost**: circular icon button, `btn-ghost btn-circle`.

---

### 13. Maintenance

This doc is the **source of truth** for new design decisions. When the system grows:

- New archetypes get a numbered subsection in §4 or §5.
- New anti-patterns get added to §10 with a real source reference.
- Updates to existing principles require a brief why-changed note in the relevant section.

Cross-references that must stay in sync:

- `CLAUDE.md` E-ink mode section → §8 of this doc.
- `docs/safe-area-insets.md` → §9 (cross-platform).
- `src/styles/globals.css` `[data-eink]` rules → §8.
- `src/styles/themes.ts` Palette type → §3 token table.

If you change a rule here, search for the cross-reference and update both.


### 14. Glossa mind maps — 2026-09-13

The EPUB trailing pane uses one destination row (Conversation / Mind map / Notes), with an ink underline, a pane menu and Close. Excerpt search belongs to its own toolbar. Within Mind map, keep the map title and AI generation action above a quieter segmented Outline / Mind map view switch. Avoid repeated titles and equal-weight nested tabs.

AI maps and blank maps use the same editable ordered tree. Favor compact text hierarchy, fine logical connectors and an ink root in the horizontal map; paper/ink surfaces, shared rounded icons and readable wrapping throughout. Common editing and undo actions stay visible. Map management and selected-idea actions belong to separate menus. No teaching microcopy, decorative palettes, gradients, source badges or explanation cards.

Click a sourced node to verify and navigate to local text, shown in a restrained excerpt pane below the editor. Double-click, F2 or the visible edit button changes an idea. Preserve immutable generated provenance; edited labels and new manual nodes are never certified quotations. The excerpt pane labels edited ideas and interpretations, supports multiple original passages, failure retry and return to reading position. Manual outline nodes still support direct entry.

Use logical spacing for RTL, visible keyboard focus, compact controls matching Conversation, touch targets on coarse pointers, and explicit e-ink borders. Keep canvas scrolling inside the workspace and source text selectable. Success saving status is announced accessibly; actionable errors remain visible. See `../../docs/design/mindmap.md` and `src/styles/glossa-mindmap.css`.
