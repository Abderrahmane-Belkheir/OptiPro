import express from 'express';
import { createTenantAuthenticator, removePhotoFiles, uploadError } from './imageUpload.js';

// A frame's or accessory's id: the same plain-id rule as the upload's product code.
const PRODUCT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * Deleting a frame or an accessory, together with its photos (the router is mounted at /api):
 *
 *   DELETE /api/frames/<id>
 *   DELETE /api/accessories/<id>
 *   Authorization: Bearer <tenant key>
 *
 *   200 { "id": "<id>", "type": "frame", "deleted": true, "photos": { "deleted": 3, "filesRemoved": 3 } }
 *
 * In this order:
 *   1. the tenant key must exist in the tenants table (`findTenantByKey`)                   -> 401 otherwise
 *   2. the id must be a plain id                                                            -> 400 otherwise
 *   3. `deleteProductWithPhotos` — one transaction that locks the product (this tenant's), FETCHES its
 *      photos' ids, and deletes the product (the rows of its photos go with it)             -> 404 if the tenant has no
 *      such product, 409 PRODUCT_IN_USE if other records still refer to it
 *   4. only AFTER that succeeded, the photos' files are deleted from the disk
 *      (`removePhotoFiles`); a file that cannot be removed is reported, the others are still removed.
 */
export function createProductDeleteRouter({ findTenantByKey, deleteProductWithPhotos, imagesDir }) {
  const router = express.Router();
  const authenticate = createTenantAuthenticator(findTenantByKey);

  const handler = (type) => async (req, res) => {
    const { id } = req.params;
    if (!PRODUCT_ID.test(id)) {
      uploadError(res, 400, 'INVALID_PRODUCT_ID', `The ${type} id must be 1-100 letters, digits, dots, dashes or underscores, starting with a letter or digit.`);
      return;
    }

    let photoIds;
    try {
      photoIds = await deleteProductWithPhotos({ tenantKey: req.tenantKey, type, id });
    } catch (err) {
      if (err?.code === 'PRODUCT_IN_USE') {
        uploadError(res, 409, 'PRODUCT_IN_USE', `The ${type} "${id}" cannot be deleted because other records (for example order lines) still refer to it. Nothing was deleted.`, { productType: type, productCode: id });
        return;
      }
      throw err;
    }
    if (photoIds === null) {
      uploadError(res, 404, 'PRODUCT_NOT_FOUND', `This shop has no ${type} with the id "${id}", so nothing was deleted.`, { productType: type, productCode: id });
      return;
    }

    // The product and its photo rows are gone: now their files.
    let filesRemoved = 0;
    const failed = [];
    for (const photoId of photoIds) {
      try {
        if (await removePhotoFiles(imagesDir, photoId)) filesRemoved += 1;
      } catch (err) {
        console.error(`${type} ${id}: photo ${photoId} was deleted but its file could not be removed:`, err.message);
        failed.push(photoId);
      }
    }
    if (failed.length > 0) {
      uploadError(res, 500, 'FILE_REMOVAL_FAILED', `The ${type} and its photo records were deleted, but ${failed.length} of its ${photoIds.length} photo file(s) could not be removed from the server's disk. Contact the server's administrator with these photo ids: ${failed.join(', ')}.`, { id, productType: type, recordDeleted: true, photos: { deleted: photoIds.length, filesRemoved, filesFailed: failed } });
      return;
    }
    res.json({ id, type, deleted: true, photos: { deleted: photoIds.length, filesRemoved } });
  };

  router.delete('/frames/:id', authenticate, handler('frame'));
  router.delete('/accessories/:id', authenticate, handler('accessory'));

  router.use((err, _req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof URIError) return uploadError(res, 400, 'MALFORMED_ADDRESS', 'The address contains an invalid percent-escape.');
    console.error('Deleting a product failed:', err);
    return uploadError(res, 500, 'SERVER_ERROR', 'The product could not be deleted because of a problem on the server. Nothing was deleted; the same request can be sent again.', { retry: 'same-request' });
  });

  return router;
}
