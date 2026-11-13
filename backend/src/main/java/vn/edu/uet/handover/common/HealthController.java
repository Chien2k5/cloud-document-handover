package vn.edu.uet.handover.common;

import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {
    private final JdbcTemplate jdbc;
    public HealthController(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    @GetMapping("/api/v1/health")
    Map<String, String> health() {
        try {
            jdbc.queryForObject("SELECT 1", Integer.class);
        } catch (DataAccessException e) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "DB_UNAVAILABLE", "Database unavailable");
        }
        return Map.of("status", "UP");
    }
}
