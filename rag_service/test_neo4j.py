"""
Neo4j AuraDB connection diagnostic — tries all URI schemes.
Run: venv\Scripts\python test_neo4j.py
"""
import asyncio
import os
from dotenv import load_dotenv
load_dotenv()

URI  = os.getenv("NEO4J_URI", "")
USER = os.getenv("NEO4J_USER", "neo4j")
PASS = os.getenv("NEO4J_PASSWORD", "")

host = URI.split("://")[-1]   # e.g. 427aace3.databases.neo4j.io

print(f"URI  : {URI}")
print(f"HOST : {host}")
print(f"USER : '{USER}'")
print(f"PASS : {PASS}")
print()

async def try_connect(label, uri, **kwargs):
    from neo4j import AsyncGraphDatabase
    print(f"Trying [{label}] {uri} ...")
    driver = AsyncGraphDatabase.driver(uri, auth=(USER, PASS), **kwargs)
    try:
        result = await driver.execute_query("RETURN 1 AS n")
        print(f"  SUCCESS!")
        await driver.close()
        return True
    except Exception as e:
        short = str(e)[:120]
        print(f"  FAILED: {type(e).__name__}: {short}")
        try:
            await driver.close()
        except Exception:
            pass
        return False

async def main():
    # Try all combinations
    schemes = [
        ("neo4j+ssc", f"neo4j+ssc://{host}"),
        ("bolt+ssc",  f"bolt+ssc://{host}"),
        ("neo4j+s",   f"neo4j+s://{host}"),
    ]
    for label, uri in schemes:
        if await try_connect(label, uri):
            print(f"\nWORKING SCHEME: use '{uri}' as NEO4J_URI")
            return

    print()
    print("All failed with AuthError — password is wrong.")
    print()
    print("OPEN Neo4j Browser in console.neo4j.io:")
    print("  1. Click 'Open' button on your instance")
    print("  2. It will open Neo4j Browser")
    print("  3. Try logging in with username=neo4j and your password")
    print("  4. If that fails too, the password was not saved correctly")
    print()
    print("If it fails in browser, click 'Reset password' inside Neo4j Browser")
    print("at the top-right profile icon.")

asyncio.run(main())
