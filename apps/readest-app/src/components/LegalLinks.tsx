import { useTranslation } from '@/hooks/useTranslation';
import Link from './Link';

const LegalLinks = () => {
  const _ = useTranslation();
  return (
    <div className='my-2 flex flex-wrap justify-center gap-4 text-sm sm:text-xs'>
      <Link href='https://readest.com/terms-of-service' className='link'>
        {_('Readest Cloud Terms of Service')}
      </Link>
      <Link href='https://readest.com/privacy-policy' className='link'>
        {_('Readest Cloud Privacy Policy')}
      </Link>
    </div>
  );
};

export default LegalLinks;
