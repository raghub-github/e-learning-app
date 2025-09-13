// src/app/api/pdfs/signed-url/route.js
import { NextResponse } from 'next/server';
import { getDownloadSignedUrl, getUploadSignedUrl } from '@/lib/cloudflare';
import dbConnect from '@/lib/dbConnect';
import Pdf from '@/models/Pdf';
import Entitlement from '@/models/Entitlement';
import { getUserFromRequest } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';

/**
 * POST /api/pdfs/signed-url
 * Body: { type: "download"|"upload", r2Key, contentType? }
 */
export async function POST(req) {
  try {
    const body = await req.json();
    const { type, r2Key, contentType } = body;

    if (!type || !r2Key) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Ensure DB connection
    await dbConnect();

    // Get current user
    const user = await getUserFromRequest(req);

    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (type === 'download') {
      // Lookup PDF metadata
      const pdf = await Pdf.findOne({ r2Key }).lean();

      if (!pdf) {
        return NextResponse.json({ success: false, error: 'PDF not found' }, { status: 404 });
      }

      // If paid, verify entitlement
      if (pdf.isPaid) {
        const hasAccess = await Entitlement.hasAccess(user._id, 'pdf', pdf._id);
        if (!hasAccess) {
          return NextResponse.json(
            { success: false, error: 'Access denied. Purchase required.' },
            { status: 403 }
          );
        }
      }

      // Generate signed download URL
      const url = await getDownloadSignedUrl(r2Key, 300); // 5 mins

      return NextResponse.json({
        success: true,
        type: 'download',
        url,
        expiresIn: 300,
      });
    }

    if (type === 'upload') {
      // Only admin can upload
      await requireRole('admin')(async () => {})(req);

      const url = await getUploadSignedUrl(r2Key, 300, contentType || 'application/pdf');

      return NextResponse.json({
        success: true,
        type: 'upload',
        url,
        expiresIn: 300,
      });
    }

    return NextResponse.json({ success: false, error: 'Invalid type' }, { status: 400 });
  } catch (error) {
    console.error('Signed URL API Error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}
