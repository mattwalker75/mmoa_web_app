#!/bin/bash
#
#  Setup MySQL (MariaDB) locally for the mmoa_web_app.
#  Reads the database / user / password from config.json and bootstraps
#  the schema by executing setup_mysql_db.sql under root.
#
#  WARNING: drops and recreates the database named in config.json
#  (database.mysql.database, default mmoa_web_app). ALL DATA IS LOST.
#
#######################

cd "$(dirname "$0")"

MYSQL_COMMAND="/opt/homebrew/bin/mysql"


#######################
#
#  Make sure needed commands are in place
#
which jq > /dev/null 2>&1
if (( $? != 0 ))
then
   echo "You need to install the jq command"
   echo "RUN:  brew install jq"
   exit 255
fi

which mysql > /dev/null 2>&1
if (( $? != 0 ))
then
   echo "You need to install Mariadb (MySQL)"
   echo "RUN:  brew install mariadb"
   exit 255
fi


#######################
#
#  Make sure MariaDB (MySQL) is running
#
brew services info mariadb | grep User > /dev/null
if (( $? != 0 ))
then
   echo "It looks like the Mariadb (MySQL) database is not running"
   echo "RUN TO START:  brew services start mariadb"
   echo "RUN TO STOP:   brew services stop mariadb"
   exit 255
fi


#######################
#
#  Get Mariadb (MySQL) database name, user name, and user password
#  from the config.json file
#
DATABASE_NAME=$(jq -r '.database.mysql.database // "mmoa_web_app"' config.json)
USER_NAME=$(jq -r '.database.mysql.user // "mmoa_app"' config.json)
USER_PASSWORD=$(jq -r '.database.mysql.password // ""' config.json)

# setup_mysql_db.sql creates and USEs `mmoa_web_app` by name. A different
# database name in config.json would leave the app pointing at an empty DB.
if [ "$DATABASE_NAME" != "mmoa_web_app" ]
then
   echo "config.json database.mysql.database is \"$DATABASE_NAME\" but setup_mysql_db.sql builds \"mmoa_web_app\"."
   echo "Use mmoa_web_app, or edit the CREATE DATABASE / USE lines in setup_mysql_db.sql to match."
   exit 1
fi


#######################
#
#  Setup database
#
echo "Delete old database..."
echo "DROP DATABASE IF EXISTS ${DATABASE_NAME};" | sudo ${MYSQL_COMMAND} -u root

echo "Delete user..."
echo "DROP USER IF EXISTS \"${USER_NAME}\"@\"localhost\";" | sudo ${MYSQL_COMMAND} -u root

echo "Setting up User...."
echo "CREATE USER IF NOT EXISTS \"${USER_NAME}\"@\"localhost\" IDENTIFIED BY \"${USER_PASSWORD}\";" | sudo ${MYSQL_COMMAND} -u root

echo "Creating Database...."
echo "CREATE DATABASE IF NOT EXISTS ${DATABASE_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" | sudo ${MYSQL_COMMAND} -u root

echo "Setting up Permissions...."
echo "GRANT SELECT, INSERT, UPDATE, DELETE ON ${DATABASE_NAME}.* TO \"${USER_NAME}\"@\"localhost\";" | sudo ${MYSQL_COMMAND} -u root
echo "FLUSH PRIVILEGES;" | sudo ${MYSQL_COMMAND} -u root

echo "Building out Database content for application..."
sudo ${MYSQL_COMMAND} -u root < setup_mysql_db.sql
