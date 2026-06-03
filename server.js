import 'dotenv/config';
import { createApp } from './api/index.js';

const port = Number(process.env.PORT || 3030);
const app = createApp();

app.listen(port, () => {
  console.log(`NordKone Leads listening on http://localhost:${port}`);
});
