import { useState } from 'react';
import { alertsOn, setAlertsOn } from './turnAlert.js';
import { useSoundSettings, setSound, setVoice } from './tableSfx.js';

// The three sound switches in a card table's top bar, each remembered on this device:
// 🔔 提醒 (a ding when it's your turn), 🔊 音效 (cards, tiles, bombs), 🗣 报牌 (the calls, spoken).
// On a narrow screen only the icons show. 21 点 has no turn ding and nothing to call out: soundOnly.
export default function SoundToggles({ soundOnly = false }) {
  const [alerts, setAlerts] = useState(alertsOn);
  const { sound, voice, canVoice } = useSoundSettings();
  const toggleAlerts = () => { setAlertsOn(!alerts); setAlerts(!alerts); };
  return (
    <span className="gt-toggles">
      {!soundOnly && <button onClick={toggleAlerts} aria-pressed={alerts} aria-label="轮到你时提醒" title={alerts ? '轮到你时响一声（点一下关掉）' : '轮到你时不响（点一下打开）'}
        className={'gt-pill' + (alerts ? '' : ' off')}>{alerts ? '🔔' : '🔕'}<span> 提醒</span></button>}
      <button onClick={() => setSound(!sound)} aria-pressed={sound} aria-label="音效" title={sound ? '出牌、炸弹这些声音开着（点一下关掉）' : '音效关着（点一下打开）'}
        className={'gt-pill' + (sound ? '' : ' off')}>{sound ? '🔊' : '🔇'}<span> 音效</span></button>
      {canVoice && !soundOnly && <button onClick={() => setVoice(!voice)} aria-pressed={voice} aria-label="报牌" title={voice ? '出了什么牌会念出来（点一下关掉）' : '不念牌（点一下打开）'}
        className={'gt-pill' + (voice ? '' : ' off')}>🗣<span> 报牌</span></button>}
    </span>
  );
}
