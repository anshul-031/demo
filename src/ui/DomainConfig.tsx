import React from 'react';

interface DomainConfigProps {
  domain: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

export const DomainConfig: React.FC<DomainConfigProps> = ({ domain, onChange, disabled }) => {
  return (
    <div style={{ marginBottom: '1rem' }}>
      <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>API Domain</label>
      <input
        type="text"
        value={domain}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://www.aicallmetrics.com"
        style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: 6 }}
      />
      <small style={{ color: '#555' }}>Change this if you want to test against a different deployment (must include protocol).</small>
    </div>
  );
};
