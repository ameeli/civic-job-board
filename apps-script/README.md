# Gmail forwarding script (placeholder)

Nothing is implemented here yet.

Some newsletters only arrive by email. They will be sent to a dedicated Gmail
account, and a [Google Apps Script](https://developers.google.com/apps-script)
bound to that account will forward each new message to the app:

1. A time-driven trigger runs the script periodically.
2. The script finds new newsletter messages in the inbox.
3. It sends each message's sender, subject, date, and body to an authenticated
   API route on the Vercel app, which stores it for the daily check to extract
   jobs from.
4. It labels each forwarded message so it is not sent twice.

The script source will live in this folder. Its endpoint URL and shared secret
will be stored in the script's properties, never committed.
