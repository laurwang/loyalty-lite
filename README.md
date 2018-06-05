# Loyalty Lite

Use Twilio to deliver a digital loyalty punchcard by SMS/MMS, using a separate campaign management service for delivering the punchcard functionality and lifecycle.  This project solely fields requests for a digital punchcard, represented by a serial number and identifying information (the phone number of the requester) embedded in a QR Code.  It also maintains a record of which phone numbers relate to which serial numbers.  Separate services would scan the QR Code, interface with a POS system to incorporate the QR code data into a transaction rung at the till, and reach out to a campaign management service to maintain the loyalty balance and verify eligibility of transactions/redemptions.

Codes

	CARD: return a QR Code of the digital punchcard(s) associated with the requesting phone number.  Creates a new punchcard if none exists.
	NEW: Creates a new punchcard.

NB Twilio has handling for default anti-pestering codes (e.g., STOP).

Notes
    Create an S3 bucket for your deployments and your QR code images, and update the project.yml with these.