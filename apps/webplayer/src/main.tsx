import { createRoot } from 'react-dom/client';
import { IosInstall } from './components/IosInstall';
import { App } from './App';
import './styles.css';
import { enableTvNavigation } from './tv-navigation';
enableTvNavigation();

const root = document.getElementById('root');
if (!root) throw new Error('Elemento raiz ausente');
createRoot(root).render(<><IosInstall /><App /></>);
