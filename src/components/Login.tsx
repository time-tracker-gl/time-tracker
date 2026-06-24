import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { C } from '../theme';

type Mode = 'signin' | 'signup' | 'reset';

/** E-Mail-+-Passwort-Login im rpc-Stil.
 *
 *  Bewusst ohne Magic-Link/Code: die Anmeldung läuft komplett in der App,
 *  ohne E-Mail-Round-Trip – das funktioniert auch in der installierten
 *  iPhone-PWA (die einen eigenen, von Safari getrennten Speicher hat).
 *  Voraussetzung in Supabase: E-Mail-Bestätigung ("Confirm email") aus,
 *  damit ein neues Konto sofort angemeldet ist.
 *
 *  "Passwort vergessen?" verschickt eine Reset-Mail; über deren Link setzt
 *  der Nutzer in der App ein neues Passwort (siehe SetPassword). Das dient
 *  auch der Migration alter Magic-Link-Konten, die noch kein Passwort haben.
 */
export function Login() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [resetSent, setResetSent] = useState(false);

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const pwValid = password.length >= 6;
  const matchOk = mode === 'signin' || password === password2;
  const canSubmit = emailValid && pwValid && matchOk && !busy;

  function translate(msg: string): string {
    const m = (msg || '').toLowerCase();
    if (m.includes('invalid login')) return 'E-Mail oder Passwort ist falsch.';
    if (m.includes('already registered') || m.includes('already exists') || m.includes('user already'))
      return 'Dieses Konto existiert bereits – bitte anmelden.';
    if (m.includes('at least') || m.includes('password')) return 'Das Passwort ist zu kurz (mind. 6 Zeichen).';
    if (m.includes('email')) return 'Bitte eine gültige E-Mail-Adresse eingeben.';
    return msg || 'Anmeldung fehlgeschlagen.';
  }

  function goMode(next: Mode) {
    setMode(next);
    setError('');
    setInfo('');
    setPassword2('');
    setResetSent(false);
  }

  async function submit() {
    if (!supabase || !canSubmit) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) setError(translate(error.message));
        // Erfolg: onAuthStateChange in App übernimmt.
      } else {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) {
          setError(translate(error.message));
        } else if (!data.session) {
          // Kein Session-Objekt = in Supabase ist die E-Mail-Bestätigung noch aktiv.
          setMode('signin');
          setInfo(
            'Konto angelegt. Falls in Supabase „Confirm email“ noch aktiv ist, bitte deaktivieren – danach kannst du dich hier direkt anmelden.',
          );
        }
        // mit Session: onAuthStateChange in App übernimmt.
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendReset() {
    if (!supabase || !emailValid || busy) return;
    setBusy(true);
    setError('');
    const redirect = window.location.origin + window.location.pathname;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirect });
    setBusy(false);
    if (error) setError(translate(error.message));
    else setResetSent(true);
  }

  const signup = mode === 'signup';
  const reset = mode === 'reset';

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
          {reset ? (
            resetSent ? (
              <div>
                <div style={{ background: C.accent1, color: C.lt1, padding: '9px 14px', fontWeight: 700, fontSize: 15, letterSpacing: '.04em' }}>
                  E-Mail versendet
                </div>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: '#2A333C', marginTop: 16 }}>
                  Wir haben dir an <strong>{email.trim()}</strong> einen Link geschickt. Öffne ihn und lege ein neues
                  Passwort fest. Danach meldest du dich mit E-Mail und neuem Passwort an.
                </p>
                <button
                  type="button"
                  onClick={() => goMode('signin')}
                  style={{ marginTop: 18, padding: '11px 0', background: 'transparent', color: C.accent2, fontSize: 13, fontWeight: 700, textAlign: 'left' }}
                >
                  ← Zur Anmeldung
                </button>
              </div>
            ) : (
              <div>
                <h1 style={{ margin: 0, fontWeight: 700, fontSize: 26, lineHeight: 1.15, color: C.dk1 }}>Passwort zurücksetzen</h1>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: C.greyFooter, margin: '8px 0 22px' }}>
                  Gib deine E-Mail ein – wir schicken dir einen Link, über den du ein neues Passwort festlegst.
                </p>
                <label style={{ display: 'block', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700, marginBottom: 6 }}>
                  E-Mail
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendReset()}
                  placeholder="name@firma.de"
                  autoComplete="email"
                  style={{ width: '100%', border: '1px solid #D5DBDF', padding: '12px 13px', fontSize: 15, color: C.dk1, outline: 'none', background: C.lt2 }}
                />
                {error && <p style={{ fontSize: 13, color: C.critical, margin: '12px 0 0' }}>{error}</p>}
                <button
                  type="button"
                  onClick={sendReset}
                  disabled={!emailValid || busy}
                  style={{
                    width: '100%',
                    marginTop: 18,
                    padding: 14,
                    background: emailValid && !busy ? C.accent1 : '#C7CFD4',
                    color: C.lt1,
                    fontSize: 14,
                    fontWeight: 700,
                    letterSpacing: '.04em',
                    cursor: emailValid && !busy ? 'pointer' : 'not-allowed',
                  }}
                >
                  {busy ? 'Wird gesendet …' : 'Reset-Link senden'}
                </button>
                <button
                  type="button"
                  onClick={() => goMode('signin')}
                  style={{ marginTop: 16, padding: '8px 0', background: 'transparent', color: C.accent2, fontSize: 13, fontWeight: 700, textAlign: 'left' }}
                >
                  ← Zur Anmeldung
                </button>
              </div>
            )
          ) : (
            <div>
              <h1 style={{ margin: 0, fontWeight: 700, fontSize: 26, lineHeight: 1.15, color: C.dk1 }}>
                {signup ? 'Konto erstellen' : 'Anmelden'}
              </h1>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: C.greyFooter, margin: '8px 0 22px' }}>
                {signup
                  ? 'Lege ein Passwort fest – damit meldest du dich künftig direkt in der App an.'
                  : 'Melde dich mit deiner E-Mail und deinem Passwort an.'}
              </p>

              {info && (
                <p style={{ fontSize: 13, lineHeight: 1.5, color: C.accent2, background: '#EAF2F8', padding: '10px 12px', margin: '0 0 16px' }}>
                  {info}
                </p>
              )}

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

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '16px 0 6px' }}>
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
                autoComplete={signup ? 'new-password' : 'current-password'}
                style={{ width: '100%', border: '1px solid #D5DBDF', padding: '12px 13px', fontSize: 15, color: C.dk1, outline: 'none', background: C.lt2 }}
              />

              {signup && (
                <>
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
                </>
              )}

              {!signup && (
                <button
                  type="button"
                  onClick={() => goMode('reset')}
                  style={{ marginTop: 10, padding: 0, background: 'transparent', color: C.accent2, fontSize: 13, fontWeight: 700, textAlign: 'left' }}
                >
                  Passwort vergessen?
                </button>
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
                {busy ? 'Bitte warten …' : signup ? 'Konto erstellen' : 'Anmelden'}
              </button>

              <button
                type="button"
                onClick={() => goMode(signup ? 'signin' : 'signup')}
                style={{ marginTop: 16, padding: '8px 0', background: 'transparent', color: C.accent2, fontSize: 13, fontWeight: 700, textAlign: 'left' }}
              >
                {signup ? '← Schon ein Konto? Zur Anmeldung' : 'Noch kein Konto? Konto erstellen'}
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
