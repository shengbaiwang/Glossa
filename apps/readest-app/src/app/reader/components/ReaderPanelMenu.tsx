import { Download, Ellipsis, FilePlus2, Trash2 } from '@/components/GlossaIcons';
import Dropdown from '@/components/Dropdown';
import Menu, { MenuSeparator } from '@/components/Menu';
import { useTranslation } from '@/hooks/useTranslation';
import ReaderCommandItem from './ReaderCommandItem';

function PanelActions({
  bookKey,
  setIsDropdownOpen,
}: {
  bookKey: string;
  setIsDropdownOpen?: (open: boolean) => void;
}) {
  const close = () => setIsDropdownOpen?.(false);
  return (
    <Menu
      role='menu'
      className='glossa-menu-surface dropdown-content no-triangle z-20 mt-2 w-max min-w-44 max-w-[calc(100vw-32px)]'
      onCancel={close}
    >
      <ReaderCommandItem
        id='exportAnnotations'
        bookKey={bookKey}
        icon={<Download size={16} />}
        onClose={close}
      />
      <ReaderCommandItem
        id='importAnnotations'
        bookKey={bookKey}
        icon={<FilePlus2 size={16} />}
        onClose={close}
      />
      <MenuSeparator />
      <ReaderCommandItem
        id='clearAnnotations'
        bookKey={bookKey}
        icon={<Trash2 size={16} />}
        destructive
        onClose={close}
      />
    </Menu>
  );
}

export default function ReaderPanelMenu(props: { bookKey: string }) {
  const _ = useTranslation();
  return (
    <Dropdown
      label={_('Annotation Actions')}
      className='dropdown-bottom dropdown-end'
      buttonClassName='glossa-icon-button glossa-pane-control'
      toggleButton={<Ellipsis size={18} aria-hidden='true' />}
    >
      <PanelActions {...props} />
    </Dropdown>
  );
}
