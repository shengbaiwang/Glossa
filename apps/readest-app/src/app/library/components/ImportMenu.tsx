import clsx from 'clsx';
import { FilePlus2, FolderOpen, Link } from '@/components/GlossaIcons';
import { useTranslation } from '@/hooks/useTranslation';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';
import { useSettingsStore } from '@/store/settingsStore';
import { isPluginEnabled } from '@/glossa/plugins/registry';

export interface ImportMenuProps {
  menuClassName?: string;
  setIsDropdownOpen?: (open: boolean) => void;
  onImportBooksFromFiles: () => void;
  onImportBooksFromDirectory?: () => void;
  onImportBookFromUrl?: () => void;
}

const ImportMenu: React.FC<ImportMenuProps> = ({
  menuClassName,
  setIsDropdownOpen,
  onImportBooksFromFiles,
  onImportBooksFromDirectory,
  onImportBookFromUrl,
}) => {
  const _ = useTranslation();
  const webImportEnabled = useSettingsStore((state) =>
    isPluginEnabled(state.settings, 'webImport'),
  );

  const handleImportFromFiles = () => {
    onImportBooksFromFiles();
    setIsDropdownOpen?.(false);
  };

  const handleImportFromDirectory = () => {
    onImportBooksFromDirectory?.();
    setIsDropdownOpen?.(false);
  };

  const handleImportFromUrl = () => {
    onImportBookFromUrl?.();
    setIsDropdownOpen?.(false);
  };

  return (
    <Menu
      className={clsx(
        'dropdown-content bg-base-100 rounded-box !relative z-[1] mt-3 p-2 shadow',
        menuClassName,
      )}
      onCancel={() => setIsDropdownOpen?.(false)}
    >
      <MenuItem
        label={_('Import files')}
        Icon={<FilePlus2 className='h-5 w-5' aria-hidden='true' />}
        onClick={handleImportFromFiles}
      />
      {onImportBooksFromDirectory && (
        <MenuItem
          label={_('Import folder')}
          Icon={<FolderOpen className='h-5 w-5' aria-hidden='true' />}
          onClick={handleImportFromDirectory}
        />
      )}
      {onImportBookFromUrl && webImportEnabled && (
        <MenuItem
          label={_('Import webpage')}
          Icon={<Link className='h-5 w-5' aria-hidden='true' />}
          onClick={handleImportFromUrl}
        />
      )}
    </Menu>
  );
};

export default ImportMenu;
