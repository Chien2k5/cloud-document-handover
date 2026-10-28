package vn.edu.uet.handover.upload;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;

/** Backend boundary for Dang's adapter. No implementation or AWS approval is implied. */
public interface StoragePort {
    record ObjectRef(String bucket, String objectKey, String versionId) {}
    record PutSpec(String bucket, String objectKey, String contentType, long size, Instant notAfter) {}
    record SignedRequest(String method, String url, Map<String,String> requiredHeaders, Instant expiresAt) {
        @Override public String toString() { return "SignedRequest[redacted]"; }
    }
    record VersionHead(ObjectRef ref, long size, String contentType, boolean deleteMarker) {}
    SignedRequest presignPut(PutSpec spec);
    Optional<VersionHead> headVersion(ObjectRef ref);
    /** Empty = not produced yet. Implementations must bound bytes (64 KiB) and network time. */
    Optional<byte[]> readChecksum(ObjectRef ref);
    SignedRequest presignGet(ObjectRef ref, Instant notAfter);
    class Unavailable extends RuntimeException {
        public Unavailable() { super("Storage dependency unavailable"); }
    }
}
