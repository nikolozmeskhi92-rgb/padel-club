/**
 * Alternative to Vercel Cron: run this directly from any scheduler
 * (system crontab, GitHub Actions, Railway cron) that isn't the Next.js host.
 *
 * Usage: npm run telegram:report
 * Crontab example (23:59 daily): 59 23 * * * cd /app && npm run telegram:report
 */
import "dotenv/config";
import { sendNightlyTelegramReport } from "../lib/telegram/sendReport";

sendNightlyTelegramReport()
  .then(({ summary }) => {
    console.log("Nightly report sent ✅", summary);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Nightly report failed ❌", err);
    process.exit(1);
  });
