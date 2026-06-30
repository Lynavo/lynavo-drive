import { createRoot } from 'react-dom/client';
import { App } from './App';
import './i18n';
import './styles/globals.css';
import { getProductName } from '../shared/product';

document.title = getProductName();

createRoot(document.getElementById('root')!).render(<App />);
