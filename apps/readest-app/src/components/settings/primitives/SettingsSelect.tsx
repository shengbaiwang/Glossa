import React from 'react';
import { ChevronDown as MdArrowDropDown } from '@/components/GlossaIcons';

interface SettingsSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SettingsSelectProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: SettingsSelectOption[];
  disabled?: boolean;
  ariaLabel?: string;
}

/**
 * Trailing settings value: transparent at rest, 36px desktop / 44px touch.
 * The shared wrapper draws a visible keyboard ring around value and chevron.
 */
const SettingsSelect: React.FC<SettingsSelectProps> = ({
  value,
  onChange,
  options,
  disabled,
  ariaLabel,
}) => {
  return (
    <div className='glossa-value-select relative flex max-w-[60%] items-center'>
      <select
        value={value}
        onChange={onChange}
        onKeyDown={(e) => e.stopPropagation()}
        disabled={disabled}
        aria-label={ariaLabel}
        className='glossa-value-input select settings-content h-9 w-full min-w-0 cursor-pointer !appearance-none truncate !border-0 !bg-transparent !bg-none !pe-7 !ps-2 text-end focus:!border-0 focus:!shadow-none focus:!ring-0'
        style={{
          textAlignLast: 'end',
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
      <MdArrowDropDown
        aria-hidden='true'
        className='text-base-content/55 pointer-events-none absolute end-1 h-5 w-5'
      />
    </div>
  );
};

export default SettingsSelect;
