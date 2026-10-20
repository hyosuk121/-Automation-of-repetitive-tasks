import { handler } from '../lib/http.js';
import { vercelHandler } from '../lib/vercel-handler.js';

export default vercelHandler(handler);
