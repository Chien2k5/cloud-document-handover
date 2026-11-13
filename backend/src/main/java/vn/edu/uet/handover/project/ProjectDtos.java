package vn.edu.uet.handover.project;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import vn.edu.uet.handover.common.StrictStringDeserializer;

public final class ProjectDtos {
    private ProjectDtos() {}
    public static final class CreateProject {
        @JsonProperty
        @JsonSetter(nulls=Nulls.FAIL)
        @JsonDeserialize(using=StrictStringDeserializer.class)
        @NotBlank @Size(max=150)
        private String name;

        @JsonProperty
        @JsonSetter(nulls=Nulls.FAIL)
        @JsonDeserialize(using=StrictStringDeserializer.class)
        @Size(max=2000)
        private String description = "";

        public String name() { return name; }
        public String description() { return description; }
    }
    public record SetMember(@NotNull @Pattern(regexp="EDITOR|VIEWER") String role) {}
    public record ProjectView(UUID id, String name, String description, long quotaBytes, long usedBytes,
                              long reservedBytes, String role, Instant createdAt) {}
    public record MemberView(UUID userId, String displayName, String role) {}
    public record ProjectPage(List<ProjectView> items, int page, int size) {}
}
