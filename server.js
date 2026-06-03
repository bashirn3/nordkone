import dotenv from 'dotenv';
import { createApp } from './api/index.js';

dotenv.config({ override: true });

const port = Number(process.env.PORT || 3030);
const app = createApp();

app.listen(port, () => {
  console.log(`NordKone Leads listening on http://localhost:${port}`);
});
