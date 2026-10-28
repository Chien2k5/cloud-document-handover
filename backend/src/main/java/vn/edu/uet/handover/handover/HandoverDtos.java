package vn.edu.uet.handover.handover;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import jakarta.validation.constraints.*;
import java.io.IOException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import vn.edu.uet.handover.common.StrictStringDeserializer;

public final class HandoverDtos {
    private HandoverDtos() {}
    public record CreateHandover(
        @NotBlank @Size(max=200) @JsonDeserialize(using=StrictStringDeserializer.class) String title,
        @NotEmpty List<@NotNull UUID> fileVersionIds,
        @NotEmpty List<@NotNull UUID> recipientUserIds,
        @NotNull @JsonDeserialize(using=StrictInstant.class) Instant expiresAt) {}
    public record Item(UUID fileVersionId,String filename,String versionId,String expectedSha256) {}
    public record Recipient(UUID userId,String accessStatus,Instant confirmedAt) {}
    public record Handover(UUID id,UUID projectId,String title,String status,String accessStatus,
                           Instant expiresAt,List<Item> items,List<Recipient> recipients) {}
    public record Confirmation(UUID handoverId,UUID userId,Instant confirmedAt,String status) {}
    public static class StrictInstant extends JsonDeserializer<Instant> {
        @Override public Instant deserialize(JsonParser p,DeserializationContext c) throws IOException {
            if(!p.hasToken(JsonToken.VALUE_STRING)) return (Instant)c.handleUnexpectedToken(Instant.class,p);
            try { return OffsetDateTime.parse(p.getText()).toInstant(); }
            catch(java.time.DateTimeException e) { return (Instant)c.handleWeirdStringValue(Instant.class,p.getText(),"An ISO timestamp with timezone is required"); }
        }
    }
}
