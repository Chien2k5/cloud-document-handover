"""Week 2 phase 1 HTTP regressions against the real JAR and an EMPTY test DB.

Requires DB_URL, DB_USERNAME, DB_PASSWORD and SMOKE_PSQL (psql executable path).
Starts/stops the JAR; disables only generated fixture users by SQL, never via a
new admin endpoint. All database contents must be disposable. No secrets printed.
"""
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from run_http_smoke import Client


def run():
    backend=Path(__file__).resolve().parents[1]
    for name in ('DB_URL','DB_USERNAME','DB_PASSWORD'):
        if name not in os.environ:
            raise RuntimeError(f'{name} required for an empty disposable PostgreSQL DB')
    psql=os.environ.get('SMOKE_PSQL') or shutil.which('psql')
    if not psql or not Path(psql).is_file():
        raise RuntimeError('SMOKE_PSQL must identify psql; account-disable regression is required, not skipped')
    url=urllib.parse.urlsplit(os.environ['DB_URL'].removeprefix('jdbc:'))
    if url.scheme!='postgresql' or not url.hostname or not url.path.strip('/'):
        raise RuntimeError('Use a jdbc:postgresql://host:port/disposable_database DB_URL')
    port=int(os.environ.get('PHASE1_SMOKE_PORT','18082'))
    with socket.socket() as probe:
        probe.bind(('127.0.0.1',port))
    env=os.environ.copy()
    password=secrets.token_urlsafe(24)
    env.update(SPRING_PROFILES_ACTIVE='local', LOCAL_DEMO_PASSWORD=password,
               SERVER_PORT=str(port), SESSION_COOKIE_SECURE='false',
               SERVER_SERVLET_SESSION_TIMEOUT='1m')
    sql_env=env.copy();sql_env['PGPASSWORD']=os.environ['DB_PASSWORD']

    def sql(statement):
        result=subprocess.run([psql,'-X','-h',url.hostname,'-p',str(url.port or 5432),
                               '-U',os.environ['DB_USERNAME'],'-d',url.path.strip('/'),
                               '-A','-t','-v','ON_ERROR_STOP=1','-c',statement],
                              env=sql_env,capture_output=True,text=True)
        if result.returncode:
            raise RuntimeError('Fixture SQL failed; no SQL/connection secrets printed')
        return result.stdout.strip()

    base=f'http://127.0.0.1:{port}/api/v1'
    clients=[];extra_checks=0;process=None
    def raw(client,method,path,expected,headers=None,body=None):
        nonlocal extra_checks
        q=urllib.request.Request(base+path,headers=headers or {},data=body,method=method)
        try:r=client.opener.open(q,timeout=10)
        except urllib.error.HTTPError as error:r=error
        with r:
            assert r.status==expected, f'{method} {path}: expected {expected}, got {r.status}'
            parsed=json.loads(r.read())
            assert parsed['requestId']==r.headers['X-Request-Id']
            extra_checks+=1
            print(f'PASS {method} {path} -> {expected}')
            return parsed

    try:
        with (backend/'target/phase1-http-server.log').open('w',encoding='utf-8') as output:
            process=subprocess.Popen(['java','-jar',str(backend/'target/document-handover-0.1.0-SNAPSHOT.jar')],
                                     cwd=backend,env=env,stdout=output,stderr=subprocess.STDOUT,
                                     creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            deadline=time.monotonic()+45
            while True:
                if process.poll() is not None:raise RuntimeError('JAR exited before readiness; inspect target/phase1-http-server.log')
                try:
                    with urllib.request.urlopen(base+'/health',timeout=1) as r:
                        if r.status==200:break
                except (urllib.error.URLError,TimeoutError):pass
                if time.monotonic()>deadline:raise RuntimeError('Readiness timeout')
                time.sleep(.25)
            reader,writer=[Client(base) for _ in range(2)];clients=[reader,writer]
            user=reader.login('dung',password);writer.login('dung',password)
            account=str(uuid.UUID(user['id']))
            public_logout,public_login=[Client(base) for _ in range(2)]
            clients.extend((public_logout,public_login))
            public_logout.login('dung',password);public_login.login('dung',password)
            for field in ('name','description'):
                for value in (None,123,1.5,False,[],{}):
                    body={'name':'valid'};body[field]=value
                    result=reader.request('POST','/projects',400,body,token=reader.csrf)
                    assert result['code']=='VALIDATION_ERROR'
            for body in ({},{'name':''},{'name':' '},{'name':'valid','quotaBytes':1}):
                reader.request('POST','/projects',400,body,token=reader.csrf)
            assert sql('SELECT count(*) FROM projects')=='0'
            first=reader.request('POST','/projects',201,{'name':'Omitted description'},token=reader.csrf)
            assert first['description']==''
            second=reader.request('POST','/projects',201,{'name':'Explicit description','description':' text '},token=reader.csrf)
            assert second['description']=='text'
            for media in ('text/plain','application/x-www-form-urlencoded'):
                body=raw(reader,'POST','/projects',415,{'Content-Type':media,'X-CSRF-TOKEN':reader.csrf},b'name=invalid')
                assert body['code']=='UNSUPPORTED_MEDIA_TYPE'
            assert raw(reader,'GET','/auth/me',406,{'Accept':'text/plain'})['code']=='NOT_ACCEPTABLE'
            assert sql('SELECT count(*) FROM projects')=='2'
            old_cookie=writer.session_id()
            sql(f"UPDATE app_users SET enabled=false WHERE id='{account}'")
            public_logout.request('GET','/health',200)
            token=public_logout.request('GET','/auth/csrf',200)['token']
            public_logout.request('POST','/auth/logout',204,token=token)
            public_logout.request('GET','/auth/me',401)
            # An existing disabled principal cannot block public bootstrap/login.
            token=public_login.request('GET','/auth/csrf',200)['token']
            switched=public_login.request('POST','/auth/login',200,
                {'email':'editor@example.test','password':password},form=True,token=token)
            assert switched['email']=='editor@example.test'
            token=public_login.request('GET','/auth/csrf',200)['token']
            assert public_login.request('GET','/auth/me',200)['id']==switched['id']
            public_login.request('POST','/auth/logout',204,token=token)
            reader.request('GET','/health',200) # readiness remains public despite old disabled session
            result=reader.request('GET','/auth/me',401)
            assert result['code']=='ACCOUNT_DISABLED'
            result=writer.request('POST','/projects',401,{'name':'Disabled write must not happen'},token=writer.csrf)
            assert result['code']=='ACCOUNT_DISABLED'
            assert sql('SELECT count(*) FROM projects')=='2'
            writer.request('GET','/auth/me',401)
            blocked=Client(base);clients.append(blocked)
            token=blocked.request('GET','/auth/csrf',200)['token']
            assert blocked.request('POST','/auth/login',401,{'email':'dung@example.test','password':password},
                                   form=True,token=token)['code']=='INVALID_CREDENTIALS'
            sql(f"UPDATE app_users SET enabled=true WHERE id='{account}'")
            assert raw(writer,'GET','/auth/me',401,{'Cookie':'JSESSIONID='+old_cookie})['code']=='UNAUTHENTICATED'
            # Re-enabling the account must require a fresh login; old sessions never revive.
            writer.login('dung',password)
            writer.request('GET','/auth/me',200)
            writer.request('POST','/auth/logout',204,token=writer.csrf)
            writer.request('GET','/auth/me',401)
            expired=Client(base);clients.append(expired)
            expired.login('dung',password)
            expired.request('GET','/auth/me',200)
            print('Waiting 65 seconds without requests for real servlet session expiry',flush=True)
            time.sleep(65)
            assert expired.request('GET','/auth/me',401)['code']=='UNAUTHENTICATED'
            expired.request('POST','/projects',403,{'name':'Expired session'},token=expired.csrf)
            fresh=expired.request('GET','/auth/csrf',200)['token']
            expired.request('POST','/auth/logout',204,token=fresh)
            expired.request('GET','/auth/me',401)
            print(json.dumps({'status':'PASS','httpChecks':sum(c.checks for c in clients)+extra_checks,
                              'strictJson':True,'unsupportedMedia415':True,'disabledReadAndWriteBlocked':True,
                              'invalidatedSessionNotRevived':True,'fixtureSqlOnly':True,
                              'disabledPublicLoginAndLogout':True,'realSessionExpiry':True,
                              'testSessionTimeoutSeconds':60,'idleWaitSeconds':65}))
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)


if __name__=='__main__':
    run()
