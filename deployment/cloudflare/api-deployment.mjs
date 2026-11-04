const resourceName = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const databaseUUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

// This is the installer-owned API Worker. Only website service bindings may
// reach it. The deployment engine supplies the token as a Worker secret.
export function apiDeploymentMetadata({ databaseID, bucketName, managementOrigin, customerOrigin, imagesApproved = false }) {
  if (!databaseUUID.test(databaseID) || !resourceName.test(bucketName)) throw new Error('Invalid D1 or R2 binding');
  const origin = new URL(managementOrigin);
  const customer = new URL(customerOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== managementOrigin) throw new Error('Invalid management origin');
  if (customer.protocol !== 'https:' || customer.origin !== customerOrigin || customer.origin === origin.origin) {
    throw new Error('Invalid customer origin');
  }
  return {
    main_module: 'api-worker.mjs', compatibility_date: '2026-11-03',
    bindings: [
      { name: 'DB', type: 'd1', id: databaseID },
      { name: 'MEDIA', type: 'r2_bucket', bucket_name: bucketName },
      ...(imagesApproved === true ? [{ name: 'IMAGES', type: 'images' }] : []),
      { name: 'MANAGEMENT_ORIGIN', type: 'plain_text', text: origin.origin },
      { name: 'CUSTOMER_ORIGIN', type: 'plain_text', text: customer.origin },
    ],
  };
}

export const privateWorkerSubdomain = Object.freeze({ enabled: false, previews_enabled: false });
export const apiMaintenanceSchedule = Object.freeze([{ cron: '* * * * *' }]);
