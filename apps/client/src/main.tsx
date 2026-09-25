import { render } from 'preact';
import { App } from './app/App.tsx';
import { account, refreshAccount } from './state/account.ts';
import './styles.css';

render(<App />, document.getElementById('app') as HTMLElement);
// Online features appear once the Worker answers; local play never waits for it. A build made
// with VITE_OFFLINE=1 (static hosting without the Worker) never asks.
if (import.meta.env.VITE_OFFLINE === '1') account.value = { kind: 'offline' };
else void refreshAccount();
