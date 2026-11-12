import java.sql.*;
import java.util.Properties;
import java.security.cert.CertificateExpiredException;
/** Disposable local TLS probe. Never prints credentials or raw connection URL. */
public class JdbcTlsProbe {
 public static void main(String[] args) {
  Properties properties=new Properties();properties.setProperty("user",System.getenv("TLS_TEST_USER"));properties.setProperty("password",System.getenv("TLS_TEST_PASSWORD"));
  try(Connection c=DriverManager.getConnection(System.getenv("TLS_TEST_URL"),properties);Statement s=c.createStatement();ResultSet r=s.executeQuery("SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()")) {
   if(!r.next() || !r.getBoolean(1)) throw new IllegalStateException("Connection was not encrypted");
   System.out.println("CONNECTED_TLS");
  } catch(Exception e) {
   String reason="OTHER";
   for(Throwable t=e;t!=null;t=t.getCause()) {
    String message=t.getMessage()==null?"":t.getMessage().toLowerCase();
    if(t instanceof CertificateExpiredException)reason="EXPIRED";
    else if(reason.equals("OTHER") && message.contains("hostname"))reason="HOSTNAME";
    else if(reason.equals("OTHER") && (message.contains("root certificate") || t instanceof java.io.FileNotFoundException))reason="ROOT_CERT";
    else if(reason.equals("OTHER") && (message.contains("pkix") || t instanceof javax.net.ssl.SSLHandshakeException))reason="CERTIFICATE";
    else if(reason.equals("OTHER") && message.contains("does not support ssl"))reason="NO_TLS";
    else if(reason.equals("OTHER") && message.contains("pg_hba.conf rejects"))reason="TLS_REQUIRED";
   }
   System.out.println("CONNECTION_REJECTED reason="+reason);System.exit(2);
  }
 }
}