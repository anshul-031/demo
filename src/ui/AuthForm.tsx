import React, { useState } from 'react';

interface AuthFormProps {
  onLogin: (email: string, password: string) => Promise<void> | void;
  disabled?: boolean;
}

export const AuthForm: React.FC<AuthFormProps> = ({ onLogin, disabled }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onLogin(email, password);
  };

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid #e2e8f0', borderRadius: 8 }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>Authenticate</h2>
      <div style={{ marginBottom: '0.75rem' }}>
        <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={disabled}
          style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: 6 }}
        />
      </div>
      <div style={{ marginBottom: '0.75rem' }}>
        <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Password</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={disabled}
          style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: 6 }}
        />
      </div>
      <button
        type="submit"
        disabled={disabled}
        style={{ background: '#2563eb', color: '#fff', padding: '0.55rem 1rem', borderRadius: 6, fontWeight: 600, cursor: 'pointer', border: 'none' }}
      >
        Login
      </button>
    </form>
  );
};
