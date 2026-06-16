import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { C } from '../theme';

type Status = 'idle' | 'sending' | 'sent' | 'error';

/** Passwordless magic-link login in rpc style. */
export function Login() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  async function submit() {
    if (!supabase || !valid || status === 'sending') return;
    setStatus('sending');
    setMessage('');
    const redirect = window.location.origin + window.location.pathname;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirect },
    });
    if (error) {
      setStatus('error');
      setMessage(error.message);
    } else {
      setStatus('sent');
    }
  }

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        justifyContent: 'center',
        background: '#DDE3E7',
        fontFamily: "'Roboto Condensed','Roboto',system-ui,sans-serif",
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 430,
          height: '100vh',
          background: C.lt1,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 0 40px rgba(14,23,33,.14)',
        }}
      >
        <header style={{ flex: '0 0 auto', padding: '18px 20px 14px', display: 'flex', alignItems: 'baseline', gap: 9, borderBottom: '1px solid #EAEDEF' }}>
          <span style={{ fontWeight: 700, fontSize: 22, letterSpacing: '-.5px', color: C.accent1 }}>rpc</span>
          <span style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 500 }}>
            Zeiterfassung
          </span>
        </header>

        <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 28px' }}>
          {status === 'sent' ? (
            <div>
              <div style={{ background: C.accent1, color: C.lt1, padding: '9px 14px', fontWeight: 700, fontSize: 15, letterSpacing: '.04em' }}>
                E-Mail versendet
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: '#2A333C', marginTop: 16 }}>
                Wir haben dir einen Anmelde-Link an <strong>{email.trim()}</strong> geschickt. Öffne die E-Mail auf
                diesem Gerät und tippe auf den Link, um dich anzumelden.
              </p>
              <button
                type="button"
                onClick={() => setStatus('idle')}
                style={{ marginTop: 18, padding: '11px 0', background: 'transparent', color: C.accent2, fontSize: 13, fontWeight: 700 }}
              >
                ← Andere E-Mail verwenden
              </button>
            </div>
          ) : (
            <div>
              <h1 style={{ margin: 0, fontWeight: 700, fontSize: 26, lineHeight: 1.15, color: C.dk1 }}>Anmelden</h1>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: C.greyFooter, margin: '8px 0 22px' }}>
                Gib deine E-Mail ein – du bekommst einen Anmelde-Link zugeschickt. Kein Passwort nötig.
              </p>
              <label style={{ display: 'block', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700, marginBottom: 6 }}>
                E-Mail
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder="name@firma.de"
                autoComplete="email"
                style={{ width: '100%', border: '1px solid #D5DBDF', padding: '12px 13px', fontSize: 15, color: C.dk1, outline: 'none', background: C.lt2 }}
              />
              {status === 'error' && (
                <p style={{ fontSize: 13, color: C.critical, margin: '10px 0 0' }}>{message || 'Anmeldung fehlgeschlagen.'}</p>
              )}
              <button
                type="button"
                onClick={submit}
                disabled={!valid || status === 'sending'}
                style={{
                  width: '100%',
                  marginTop: 18,
                  padding: 14,
                  background: valid && status !== 'sending' ? C.accent1 : '#C7CFD4',
                  color: C.lt1,
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: '.04em',
                  cursor: valid && status !== 'sending' ? 'pointer' : 'not-allowed',
                }}
              >
                {status === 'sending' ? 'Wird gesendet …' : 'Anmelde-Link senden'}
              </button>
            </div>
          )}
        </div>

        <div style={{ flex: '0 0 auto', padding: '14px 20px', borderTop: '1px solid #EAEDEF', fontSize: 11, color: C.muted, textAlign: 'center' }}>
          Deine Zeiten werden sicher in deinem Konto gespeichert.
        </div>
      </div>
    </div>
  );
}
