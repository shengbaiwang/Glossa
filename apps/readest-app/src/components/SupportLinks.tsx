import { FaGithub } from 'react-icons/fa';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { GLOSSA_ISSUES_URL } from '@/services/constants';
import Link from './Link';

const SupportLinks = () => {
  const _ = useTranslation();
  const iconSize = useResponsiveSize(24);

  return (
    <div className='my-2 flex flex-col items-center gap-2'>
      <p className='text-neutral-content text-sm'>{_('Glossa support')}</p>
      <div className='flex gap-4'>
        <Link
          href={GLOSSA_ISSUES_URL}
          className='btn btn-sm eink-bordered flex items-center gap-2'
          title='GitHub'
          aria-label='GitHub'
        >
          <FaGithub size={iconSize} />
          GitHub
        </Link>
      </div>
    </div>
  );
};

export default SupportLinks;
