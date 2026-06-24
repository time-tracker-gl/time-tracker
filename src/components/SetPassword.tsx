import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { C } from '../theme';

/** Neues Passwort setzen, nachdem der Nutzer über den Reset-Link gekommen ist
 *  (Supabase hat dann eine temporäre Recovery-Session erstellt). */
export function SetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const pwValid = password.length >= 6;
  const matchOk = password === password2;
  const canSubmit = pwValid && matchOk && !busy;

  async function submit() {
    if (!supabase || !canSubmit) return;
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      const m = error.message.toLowerCase();
      if (m.includes('same') || m.includes('different')) setError('Bitte ein anderes als das bisherige Passwort wählen.');
      else if (m.includes('at least') || m.includes('password')) setError('Das Passwort ist zu kurz (mind. 6 Zeichen).');
      else if (m.includes('session') || m.includes('expired') || m.includes('token'))
        setError('Der Reset-Link ist abgelaufen. Bitte fordere einen neuen an.');
      else setError(error.message);
      return;
    }
    setDone(true);
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
          {done ? (
            <div>
              <div style={{ background: C.accent1, color: C.lt1, padding: '9px 14px', fontWeight: 700, fontSize: 15, letterSpacing: '.04em' }}>
                Passwort gesetzt
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: '#2A333C', marginTop: 16 }}>
                Dein neues Passwort ist gespeichert. Du kannst die App jetzt nutzen – künftig meldest du dich mit
                E-Mail und diesem Passwort an.
              </p>
              <button
                type="button"
                onClick={onDone}
                style={{ width: '100%', marginTop: 18, padding: 14, background: C.accent1, color: C.lt1, fontSize: 14, fontWeight: 700, letterSpacing: '.04em' }}
              >
                Weiter zur App
              </button>
            </div>
          ) : (
            <div>
              <h1 style={{ margin: 0, fontWeight: 700, fontSize: 26, lineHeight: 1.15, color: C.dk1 }}>Neues Passwort</h1>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: C.greyFooter, margin: '8px 0 22px' }}>
                Lege jetzt ein neues Passwort für dein Konto fest.
              </p>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <label style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700 }}>
                  Passwort
                </label>
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  style={{ background: 'transparent', color: C.accent2, fontSize: 12, fontWeight: 700, padding: 0 }}
                >
                  {showPw ? 'Verbergen' : 'Anzeigen'}
                </button>
              </div>
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder="mind. 6 Zeichen"
                autoComplete="new-password"
                autoFocus
                style={{ width: '100%', border: '1px solid #D5DBDF', padding: '12px 13px', fontSize: 15, color: C.dk1, outline: 'none', background: C.lt2 }}
              />

              <label style={{ display: 'block', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700, margin: '16px 0 6px' }}>
                Passwort wiederholen
              </label>
              <input
                type={showPw ? 'text' : 'password'}
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder="Passwort erneut eingeben"
                autoComplete="new-password"
                style={{ width: '100%', border: '1px solid #D5DBDF', padding: '12px 13px', fontSize: 15, color: C.dk1, outline: 'none', background: C.lt2 }}
              />
              {password2.length > 0 && password !== password2 && (
                <p style={{ fontSize: 13, color: C.critical, margin: '8px 0 0' }}>Die Passwörter stimmen nicht überein.</p>
              )}
              {error && <p style={{ fontSize: 13, color: C.critical, margin: '12px 0 0' }}>{error}</p>}

              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                style={{
                  width: '100%',
                  marginTop: 18,
                  padding: 14,
                  background: canSubmit ? C.accent1 : '#C7CFD4',
                  color: C.lt1,
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: '.04em',
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                }}
              >
                {busy ? 'Wird gespeichert …' : 'Passwort speichern'}
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
