import { Contents, Bookmark, Search } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import ReaderPaneTabs from '../ReaderPaneTabs';

export default function TabNavigation({
  activeTab,
  onTabChange,
  idPrefix,
}: {
  activeTab: string;
  onTabChange: (tab: string) => void;
  idPrefix?: string;
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
        { id: 'bookmarks', label: _('Bookmarks'), Icon: Bookmark, panelId },
        { id: 'search', label: _('Search'), Icon: Search, panelId },
      ]}
    />
  );
}
