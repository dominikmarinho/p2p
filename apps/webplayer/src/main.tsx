import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { enableTvNavigation } from './tv-navigation';
enableTvNavigation();

const root = document.getElementById('root');
if (!root) throw new Error('Elemento raiz ausente');
createRoot(root).render(<App />);
