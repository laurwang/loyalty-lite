#!/bin/sh

# First, validate that the environment has the proper required variables set.

MSG="You must set the STAGE environment variable"

fail=0
failMsg=""
check()
{
  if [ -z $(eval echo "\$$1") ]; then
    fail=`expr $fail + 1`
    if [ "x$failMsg" != "x" ]; then
      failMsg+=", "
    fi
    failMsg+="${1} was set to \"$(eval echo "\$$1")\""
  fi
}

check STAGE

if [ $fail -ne 0 ]; then
  echo "Variables UNSET: $failMsg"
  echo "$MSG"
  exit $fail
fi
