import { Contents, Bookmarks, Search, Pages } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import ReaderPaneTabs from '../ReaderPaneTabs';

export default function TabNavigation({
  activeTab,
  onTabChange,
  idPrefix,
  pdf = false,
}: {
  activeTab: string;
  onTabChange: (tab: string) => void;
  idPrefix?: string;
  pdf?: boolean;
}) {
  const _ = useTranslation();
  const panelId = idPrefix ? `${idPrefix}-panel` : undefined;
  return (
    <ReaderPaneTabs
      label={_('Sidebar')}
      activeTab={activeTab}
      onTabChange={onTabChange}
      idPrefix={idPrefix}
      tabs={[
        { id: 'toc', label: _('Contents'), Icon: Contents, panelId },
        ...(pdf ? [{ id: 'pages', label: _('PDF pages'), Icon: Pages, panelId }] : []),
        { id: 'bookmarks', label: _('Bookmarks'), Icon: Bookmarks, panelId },
        { id: 'search', label: _('Search'), Icon: Search, panelId },
      ]}
    />
  );
}
