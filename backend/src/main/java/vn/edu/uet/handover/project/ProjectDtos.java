package vn.edu.uet.handover.project;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class ProjectDtos {
    private ProjectDtos() {}
    public record CreateProject(@NotBlank @Size(max=150) String name, @Size(max=2000) String description) {}
    public record SetMember(@NotNull @Pattern(regexp="EDITOR|VIEWER") String role) {}
    public record ProjectView(UUID id, String name, String description, long quotaBytes, long usedBytes,
                              long reservedBytes, String role, Instant createdAt) {}
    public record MemberView(UUID userId, String displayName, String role) {}
    public record ProjectPage(List<ProjectView> items, int page, int size) {}
}
