package vn.edu.uet.handover.upload;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import software.amazon.awssdk.awscore.presigner.PresignedRequest;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

final class S3StorageAdapter implements StoragePort {
    private static final int MAX_RESULT_BYTES = 64 * 1024;

    private final S3Client client;
    private final S3Presigner presigner;
    private final Clock clock;

    S3StorageAdapter(S3Client client, S3Presigner presigner, Clock clock) {
        this.client = client;
        this.presigner = presigner;
        this.clock = clock;
    }

    @Override
    public SignedRequest presignPut(PutSpec spec) {
        var object = PutObjectRequest.builder().bucket(spec.bucket()).key(spec.objectKey())
                .contentType(spec.contentType()).ifNoneMatch("*").build();
        try {
            var signed = presigner.presignPutObject(PutObjectPresignRequest.builder()
                    .putObjectRequest(object).signatureDuration(lifetime(spec.notAfter())).build());
            return signedRequest(signed, spec.notAfter());
        } catch (SdkException | IllegalArgumentException e) {
            throw new Unavailable();
        }
    }

    @Override
    public Optional<VersionHead> headVersion(ObjectRef ref) {
        try {
            var object = client.headObject(HeadObjectRequest.builder()
                    .bucket(ref.bucket()).key(ref.objectKey()).versionId(ref.versionId()).build());
            if (Boolean.TRUE.equals(object.deleteMarker())) return Optional.empty();
            if (!ref.versionId().equals(object.versionId()) || object.contentLength() == null) {
                throw new Unavailable();
            }
            return Optional.of(new VersionHead(ref, object.contentLength(), object.contentType(), false));
        } catch (S3Exception e) {
            // An exact HEAD on a delete marker returns 405.
            if (e.statusCode() == 404 || e.statusCode() == 405) return Optional.empty();
            throw new Unavailable();
        } catch (SdkException e) {
            throw new Unavailable();
        }
    }

    @Override
    public Optional<byte[]> readChecksum(ObjectRef ref) {
        var request = GetObjectRequest.builder().bucket(ref.bucket()).key(resultKey(ref)).build();
        try (var body = client.getObject(request)) {
            Long size = body.response().contentLength();
            if (size == null || size < 0) {
                body.abort();
                throw new Unavailable();
            }
            if (size > MAX_RESULT_BYTES) {
                body.abort();
                // A present but oversized document is invalid, not pending.
                return Optional.of(new byte[0]);
            }
            try {
                byte[] checksum = body.readNBytes(size.intValue());
                if (checksum.length != size) throw new Unavailable();
                return Optional.of(checksum);
            } catch (IOException e) {
                body.abort();
                throw new Unavailable();
            }
        } catch (S3Exception e) {
            if (e.statusCode() == 404 && e.awsErrorDetails() != null
                    && "NoSuchKey".equals(e.awsErrorDetails().errorCode())) {
                return Optional.empty();
            }
            throw new Unavailable();
        } catch (SdkException | IOException e) {
            throw new Unavailable();
        }
    }

    @Override
    public SignedRequest presignGet(ObjectRef ref, Instant notAfter) {
        var object = GetObjectRequest.builder().bucket(ref.bucket()).key(ref.objectKey())
                .versionId(ref.versionId()).responseContentDisposition("attachment").build();
        try {
            var signed = presigner.presignGetObject(GetObjectPresignRequest.builder()
                    .getObjectRequest(object).signatureDuration(lifetime(notAfter)).build());
            var request = signedRequest(signed, notAfter);
            if (!request.requiredHeaders().isEmpty()) throw new Unavailable();
            return request;
        } catch (SdkException | IllegalArgumentException e) {
            throw new Unavailable();
        }
    }

    private Duration lifetime(Instant notAfter) {
        // Give signing a one-second margin to stay inside the service deadline.
        long seconds = Duration.between(clock.instant(), notAfter).toSeconds() - 1;
        if (seconds <= 0) throw new Unavailable();
        return Duration.ofSeconds(seconds);
    }

    private SignedRequest signedRequest(PresignedRequest signed, Instant notAfter) {
        if (signed.expiration().isAfter(notAfter)) throw new Unavailable();
        Map<String, String> headers = new LinkedHashMap<>();
        signed.signedHeaders().forEach((name, values) -> {
            if (name.equalsIgnoreCase("Host")) return;
            if (values.size() != 1) throw new Unavailable();
            headers.put(name, values.getFirst());
        });
        return new SignedRequest(signed.httpRequest().method().name(), signed.url().toExternalForm(),
                Map.copyOf(headers), signed.expiration());
    }

    static String resultKey(ObjectRef ref) {
        return "results/" + sha256(ref.bucket()) + "/" + sha256(ref.objectKey()) + "/"
                + sha256(ref.versionId()) + ".json";
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
