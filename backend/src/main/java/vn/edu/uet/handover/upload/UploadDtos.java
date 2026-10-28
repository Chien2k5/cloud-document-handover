package vn.edu.uet.handover.upload;

import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.Nulls;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import jakarta.validation.constraints.*;
import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import vn.edu.uet.handover.common.StrictStringDeserializer;

public final class UploadDtos {
    private UploadDtos() {}
    public static final class UploadRequest {
        @JsonProperty @NotBlank @Size(max=255) @JsonDeserialize(using=StrictStringDeserializer.class)
        private String filename;
        @JsonProperty @NotBlank @Size(max=255) @JsonDeserialize(using=StrictStringDeserializer.class)
        private String contentType;
        @JsonProperty @NotNull @Min(1) @Max(104857600) @JsonDeserialize(using=StrictLong.class)
        private Long size;
        @JsonProperty @NotNull @Pattern(regexp="[0-9a-f]{64}") @JsonDeserialize(using=StrictStringDeserializer.class)
        private String expectedSha256;
        @JsonProperty @JsonSetter(nulls=Nulls.FAIL)
        private UUID fileId;
        public UploadRequest() {}
        public UploadRequest(String filename,String contentType,Long size,String expectedSha256,UUID fileId) {
            this.filename=filename;this.contentType=contentType;this.size=size;this.expectedSha256=expectedSha256;this.fileId=fileId;
        }
        public String filename() { return filename; }
        public String contentType() { return contentType; }
        public Long size() { return size; }
        public String expectedSha256() { return expectedSha256; }
        public UUID fileId() { return fileId; }
    }
    public record CompleteUpload(
        @NotBlank @Pattern(regexp="(?!null$)[\\s\\S]*\\S[\\s\\S]*")
        @JsonDeserialize(using=StrictStringDeserializer.class) String versionId) {}
    public record PresignedUpload(String method, String url, Map<String,String> headers, Instant expiresAt) {
        @Override public String toString() { return "PresignedUpload[redacted]"; }
    }
    public record UploadCreated(UUID uploadId, UUID fileId, UUID fileVersionId, String uploadStatus,
                                String integrityStatus, PresignedUpload presignedUpload) {}
    public record FileVersion(UUID id, UUID fileId, String filename, String contentType, long size,
                              String versionId, String expectedSha256, String actualSha256,
                              String uploadStatus, String integrityStatus) {}
    public record UploadState(UUID uploadId, FileVersion fileVersion, Instant expiresAt) {}
    public record FilePage(List<FileVersion> items, int page, int size) {}
    public record Download(String url, String versionId, Instant expiresAt) {
        @Override public String toString() { return "Download[redacted]"; }
    }
    public static class StrictLong extends JsonDeserializer<Long> {
        @Override public Long deserialize(JsonParser p, DeserializationContext c) throws IOException {
            if (!p.hasToken(JsonToken.VALUE_NUMBER_INT)) {
                return (Long)c.handleUnexpectedToken(Long.class,p);
            }
            return p.getLongValue();
        }
    }
}
