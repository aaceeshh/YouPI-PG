# Hosting review: 20 October 2026

The gateway needs a continuous Node.js process, full browser and persistent storage for databases and the authenticated browser profile.

| Provider | Verified allowance or restriction | Suitability |
| --- | --- | --- |
| Oracle Always Free | A1: 1,500 OCPU-hours and 9,000 GB-hours per month, approximately 2 OCPUs/12 GB RAM. Home-region capacity is required; idle instances may be reclaimed. | Best free candidate, through the existing eligible account. Actual quota, capacity and merchant login remain unverified. |
| Google Cloud Compute Engine | One e2-micro within free monthly usage in Oregon, Iowa or South Carolina; 30 GB standard persistent disk and limited egress. External IPv4 costs USD 0.005/hour separately. | Alternative VM, but a normal IPv4 deployment is not fully free: approximately USD 3.60 per 30-day month for that IP alone. An IPv6-only route would need separate validation. |
| Render Free | Sleeps after 15 minutes without inbound traffic; local data is ephemeral; no free persistent disk. | Unsuitable for the authenticated browser and ledger. |
| Koyeb Free | 512 MB RAM/0.1 vCPU, mandatory sleep after an hour, no worker services or volumes. | Unsuitable for continuous observation. |
| AWS Free account plan | Ends after six months or credit exhaustion, whichever comes first. | Temporary testing only, not permanent free hosting. |
| Cloudflare Browser Rendering Free | Ten browser minutes daily. | Insufficient for continuous observation. A tunnel supplies connectivity, not a server. |

Oracle allows one Free Trial or Always Free account per person. Another email does not grant eligibility for a second free account. Recover or inspect the existing tenancy instead.

No VM has been provisioned. This is a source-backed comparison and a Linux service template, not an already-hosted service or a lifetime-free guarantee. A real merchant browser login must be tested on the chosen server.

## Official sources

- Oracle resources: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Oracle eligibility: https://www.oracle.com/cloud/free/faq/
- Google free compute: https://docs.cloud.google.com/free/docs/free-cloud-features
- Google IP pricing: https://cloud.google.com/vpc/pricing
- Render limits: https://render.com/docs/free
- Koyeb limits: https://www.koyeb.com/docs/reference/instances
- AWS duration: https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html
- Cloudflare browser quota: https://developers.cloudflare.com/changelog/post/2025-07-28-br-pricing/
