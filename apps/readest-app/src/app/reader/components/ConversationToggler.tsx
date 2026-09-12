import { MessageCircle } from '@/components/GlossaIcons';
import Button from '@/components/Button';
import { useNotebookStore } from '@/store/notebookStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

export default function ConversationToggler({ bookKey }: { bookKey: string }) {
  const _ = useTranslation();
  const visible = useNotebookStore((s) => s.isNotebookVisible);
  const tab = useNotebookStore((s) => s.notebookActiveTab);
  const sidebarBook = useSidebarStore((s) => s.sideBarBookKey);
  const active = visible && tab === 'conversation' && sidebarBook === bookKey;
  return (
    <Button
      icon={<MessageCircle size={useResponsiveSize(18)} />}
      className='glossa-icon-button'
      label={_('Conversation')}
      aria-pressed={active}
      aria-expanded={active}
      onClick={() => {
        useSidebarStore.getState().setSideBarBookKey(bookKey);
        useNotebookStore.getState().setNotebookActiveTab('conversation');
        useNotebookStore.getState().setNotebookVisible(!active);
      }}
    />
  );
}
