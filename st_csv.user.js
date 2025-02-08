// ==UserScript==
// @name         ScoutsTracker - Transaction CSV Download
// @namespace    http://1sttimberlea.ca/
// @description  CSV download of recent wallet transactions
// @author       Jean-Paul Deveaux
// @match        https://scoutstracker.ca/*/
// @updateURL    https://github.com/Jabolio/scoutstracker_macros/raw/main/st_csv.user.js
// @downloadURL  https://github.com/Jabolio/scoutstracker_macros/raw/main/st_csv.user.js
// @supportURL   https://github.com/Jabolio/scoutstracker_macros/issues
// @version      2025.02.08
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';
    const MONEY_MGMT = 'h1:contains("Money Management")',
          EVENT_DTLS = '#event-details',
          VIEW_EVENT = '#view-event',
          MEMBER_PAY = '#event-member-payments',
          MEMBER_PAY_MATCH = /doEditMemberPayment\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/,
          NO_EDIT_SPAN = '<span title="This transaction was made before the most recent CSV export, so it cannot be edited.">No Edit</span>';

    const NODES = [MONEY_MGMT, EVENT_DTLS];

    const tDATE_OPTIONS = { year: 'numeric', month: '2-digit', day: '2-digit' };
    const tDATE_FORMATTER = new Intl.DateTimeFormat('en-CA', tDATE_OPTIONS);
    const urlMatch = window.location.href.match(/ca\/([^\/]*)\//)[1];
    const tSection = urlMatch.charAt(0).toUpperCase() + urlMatch.slice(1);

    // income and expense special meeting ledgers.  Modify as needed.
    const tINCOME_LEDGERS = ['Income:Cubs Dues & Fees:Kub Kars','Income:Cubs Dues & Fees:Mini-Alert',
                             'Income:Cubs Dues & Fees:Fantasy Camp', 'Income:Cubs Dues & Fees:Cabin Event',
                             'Income:Beavers Dues & Fees:Movie Night',
                             'Income:Group Event / Activity Fees:Camp fees:Lodges and Lairs',
                             'Income:Group Event / Activity Fees:Camp fees:Year-End Group Camp',
                             'Income:Group Event / Activity Fees:Camp fees:Cabin Event',
                             'Income:Group Event / Activity Fees:Mooseheads Game'];

    const tEXPENSE_LEDGERS = ['Expenses:Cubs:Fantasy Camp','Expenses:Cubs:Kub Kar Rally','Expenses:Cubs:Mini-Alert', 
                              'Expenses:Cubs:Cabin Event','Expenses:Beavers:Movie Night',
                              'Expenses:Group Event / Activity Expenses:Camp-related:Lodges and Lairs',
                              'Expenses:Group Event / Activity Expenses:Camp-related:Year-End Camp',
                              'Expenses:Group Event / Activity Expenses:Camp-related:Cabin Event',
                              'Expenses:Group Event / Activity Expenses:Scouting Event Registration Fees',
                              'Expenses:Group Event / Activity Expenses:Mooseheads Game',
                              'Expenses:Group Event / Activity Expenses:Food and Drink'];

    let tLastCSVExport = GM_getValue('lastRun_'+tSection, 0);
    console.log('gnucash cutoff date - '+tLastCSVExport);

    class tTransaction {
        constructor(date, desc, amt, transfer, account) {
            this.date = date;
            this.description = desc;

            if(amt < 0) {
                this.amount = amt * -1;
                this.transfer = account;
                this.account = transfer;
            }
            else {
                this.amount = amt;
                this.transfer = transfer;
                this.account = account;
            }
        }

        static typeCheck() {}

        merge(that) {
            if(this.transfer == that.account && this.amount == that.amount) {
                this.transfer = that.transfer;
            }
            else if (this.account == that.transfer && this.amount == that.amount) {
                this.account = that.account;
            }
        }

        toString() {
            return this.date+"\t"+this.description+"\t"+this.amount+"\t"+this.transfer+"\t"+this.account+"\n";
        }
    };

    class tYouthTransaction extends tTransaction {
        constructor(payment, youth) {
            const liabilities = 'Liabilities:'+tSection+' Credits:'+youth;
            let date = tDATE_FORMATTER.format(new Date(payment.when));
            let description = (payment.notes === undefined ? '' : payment.notes);
            let outingID = payment.outingid, ledger = '', outing = null, eventName = '';

            if(outingID > 0) {
                outing = getOuting(outingID);
                eventName = outing.displayname;
            }

            switch(payment.type) {
                case 3: // money coming in.
                    // if 'EFT' is in the notes, or if it is a category 3 payment (EFT - Feb8/25) then it's going directly into the Checking Account
                    if(payment.category = 3 || description.toUpperCase().indexOf('EFT') >= 0) {
                        if(payment.amount < 0) {
                            throw "'EFT' keyword detected in transaction description for negative deposit - youth: "+youth+', date: '+date;
                        }

                        ledger = 'Assets:Current Assets:Checking Account';
                    }

                    // if payment category is 2, this is a cheque. 
                    else if(payment.category = 2) {
                        ledger = 'Assets:Current Assets:Cheques:'+tSection;
                    }

                    // if "fundrais" is in the description text, then it's money related to fundraising, and it should be directed to the transfers account.
                    else if (description.toUpperCase().indexOf('FUNDRAIS') >= 0) {
                        if(payment.amount < 0) {
                            throw "'Fundraise' keyword detected in transaction description for negative deposit - youth: "+youth+', date: '+date;
                        }

                        ledger = 'Expenses:Credit Transfers:'+tSection;
                    }

                    else if (description.toUpperCase().indexOf('APPLIED') >= 0) {
                        if(payment.amount > 0) {
                            throw "'Applied' keyword detected in transaction description for positive deposit - youth: "+youth+', date: '+date;
                        }

                        ledger = 'Income:Applied Credits:'+tSection;
                    }

                    else if (description.toUpperCase().indexOf('RECLAIMED') >= 0) {
                        if(payment.amount > 0) {
                            throw "'Reclaimed' keyword detected in transaction description for positive deposit - youth: "+youth+', date: '+date;
                        }

                        ledger = 'Income:Reclaimed Credits:'+tSection;
                    }

                    // if none of the above cases match, this is cash coming in, so it goes to the Cash On Hand ledger
                    else {
                        description = 'Money received, added to Wallet'
                        ledger = 'Assets:Current Assets:Cash on Hand:'+tSection;
                    }

                    break;

                case 0:
                case 1:
                    if(outingID > 0) {
                        // check if this outing ID has an entry in the local income ledger cache
                        ledger = GM_getValue('income_'+outingID, null);
                        if (!ledger) {
                            outing = getOuting(outingID);

                            // look for the meeting label.
                            for(const label of outing.labels) {
                                if(label.labelkey == 'meeting') {
                                    ledger = 'Income:'+tSection+' Dues & Fees:Meeting Dues';
                                    if(!description) {
                                        description = 'Dues paid - '+eventName;
                                    }
                                }
                            }
                        }

                        // add a description if nothing was there
                        if(!description) {
                            description = 'Event fees paid - '+eventName;
                        }

                        if(!ledger) {
                            throw "Custom ledger not defined for event - "+outing.displayname;
                        }
                    }
                    else {
                        throw "Fee processed, but not associated to event - "+youth+' -- '+date;
                    }

                    break;
            }

            // if no reason is defined by this point, then throw an error.
            if(!ledger) {
                throw "Ledger not defined - payment type: "+payment.type+", Amount: "+payment.amount+", Youth: "+youth+' on '+date;
            }

            super(date,description+" ("+date+")",payment.amount,liabilities,ledger);
        }

        static typeCheck(type) {
            return type != 2;
        }
    };

    class tScouterTransaction extends tTransaction {
        constructor(payment, scouter) {
            let date = tDATE_FORMATTER.format(new Date(payment.when));
            let description = (payment.notes === undefined ? '' : payment.notes);
            description += (description ? ' -- ' : '') + scouter;
            let ledger = '', transfer = '', outingID = payment.outingid;

            if(outingID <= 0) {
                throw 'Missing outing ID for scouter transaction';
            }

            // if 'EFT' is in the description, then it's going directly into the Checking Account
            if(payment.category = 3 || description.toUpperCase().indexOf('EFT') >= 0) {
                ledger = 'Assets:Current Assets:Checking Account';
            }

            // if 'CASH' was in the description, then mark it as cash
            else if(payment.category = 1 || description.toUpperCase().indexOf('CASH') >= 0) {
                ledger = 'Assets:Current Assets:Cash on Hand:'+tSection;
            }

            // if a category 2, this is a cheque. 
            else if(payment.category = 2) {
                ledger = 'Assets:Current Assets:Cheques:'+tSection;
            }

            // if 'DONATION' was in the description, then add it to the Income:Donations ledger -
            // the scouter has explicitly requested to not be reimbursed for this expense.
            else if(description.toUpperCase().indexOf('DONATION') >= 0) {
                ledger = 'Income:Donations';
            }

            // if the payment amount is positive and we haven't seen anything else yet, it will go into Accounts Payable.
            else if(payment.amount > 0) {
                ledger = 'Liabilities:Accounts Payable';
            }

            // this is an event reimbursement.  if custom expense ledger was defined for an event, use the generic one for that section.
            if(payment.type == 1) {
                transfer = GM_getValue('expense_'+outingID);
                if(!transfer) {
                    transfer = 'Expenses:'+tSection+':Meeting-Related Expenses';
                }
            }

            // payment by a Scouter for an event; a custom income ledger will be required for this, since Scouters don't pay for anything at meetings.
            else {
                transfer = GM_getValue('income_'+outingID);
                if(!transfer) {
                    throw 'Missing outing for Scouter payment - '+scouter+' - '+date;
                }
            }

            super(date,description+" ("+date+")",payment.amount,ledger,transfer);
        }

        // we only want payment type 0 (fee paid/refunded) or 1 (expense); type >= 2 can be ignored in this context
        static typeCheck(type) {
            return type <= 1;
        }
    };

    const tMEMBER_TYPES = {};
    tMEMBER_TYPES[MEMBERSHIP_TYPE.participant.id] = tYouthTransaction;
    tMEMBER_TYPES[MEMBERSHIP_TYPE.leader.id] = tScouterTransaction;

    var gnucash = Window.gnucash = {};
    gnucash.createCSVReport = function() {
        let transactions = [], t;
        let member, memberName, ledgerID, mapMapLedgerPayments;
        let cutOff = new Date(tLastCSVExport).getTime();

        try {
            for (const [memberType, TransactionClass] of Object.entries(tMEMBER_TYPES)) {
                getAllMemberIDs(parseInt(memberType),true).forEach(function(memberID) {
                    member = getMember( memberID );
                    memberName = member.firstname+' '+member.lastname;
                    ledgerID = member.cashledgerid;
                    mapMapLedgerPayments = clone( g_mapMapMapLedgerPayments[ledgerID] );

                    for ( const transactionID in mapMapLedgerPayments )
                    {
                        t = [];
                        for ( const type in mapMapLedgerPayments[transactionID] )
                        {
                            const payment = mapMapLedgerPayments[transactionID][type];

                            // if a payment is not deleted, and happened since the last batch, and is for this member, and is not an adjustment, then go
                            if ( (!isPaymentDeleted( payment )) && (payment.when > cutOff) && (payment.memberid == memberID) && TransactionClass.typeCheck(payment.type)) {
                                t.push(new TransactionClass(payment, memberName));
                            }
                        }

                        if(t.length > 0) {
                            // if there were two transactions, merge them, and add the member name to the transaction.
                            if(t.length == 2) {
                                t[0].merge(t[1]);
                                t[0].description = (t[0].description ? t[0].description + ' -- ' : '') + memberName;
                            }

                            transactions.push(t[0]);
                        }
                    }
                });
            }

            let date = new Date();
            let year = new Intl.DateTimeFormat('en', { year: 'numeric' }).format(date);
            let month = new Intl.DateTimeFormat('en', { month: '2-digit' }).format(date);
            let day = new Intl.DateTimeFormat('en', { day: '2-digit' }).format(date);
            let filename = 'scoutsTracker_'+tSection+'_transactions_'+year+month+day+'.csv';

            if(transactions.length == 0) {
                throw "No new transactions since last export.";
            }

            var a = document.createElement('a');
            var blob = new Blob(transactions, {'type':'application/octet-stream'});
            a.href = window.URL.createObjectURL(blob);
            a.download = filename;
            a.click();

            gnucash.updateLastRun(new Date(new Date().getTime() + new Date().getTimezoneOffset() * -60 * 1000).toISOString().slice(0, 19));
            console.log('gnucash - '+transactions.length+' new transactions exported.');
        }
        catch(err) {
            openLightBox( {
                text: err,
                canClose: true,
                size: 'big'} );
        }
    };

    gnucash.updateEventLedger = function(outing_id, ledgerType, newLedger) {
        // all possible expense categories will be in the arrays.  find the proper entry in the array and replace what was written with that.
        let found = false;
        const ledgerTypeString = (ledgerType ? 'expense' : 'income');
        for(const ledger of (ledgerType == 1 ? tEXPENSE_LEDGERS : tINCOME_LEDGERS)) {
            if(ledger.indexOf(newLedger) >= 0) {
                newLedger = ledger;
                found = true;
                break;
            }
        }

        if(found) {
            console.log('setting '+ledgerTypeString+' custom ledger for '+outing_id+' -- '+newLedger);
            $('#event-gnucash-'+ledgerTypeString+'-ledger-account').val(newLedger);
            GM_setValue(ledgerTypeString + '_' + outing_id, newLedger);
        }
        else {
            openLightBox({text: 'String "'+newLedger+'" was not found among the possible ledger names.', canClose: true, size: 'big'});
        }
    };

    gnucash.updateLastRun = function(lastRun) {
        tLastCSVExport = new Date(lastRun).getTime();
        console.log('new gnucash cutoff date - '+lastRun);
        GM_setValue('lastRun_'+tSection, lastRun);
        $('#gnucash-last-run').val(lastRun);
        return lastRun;
    }

    // monitor when the event is changed so I can properly populate the custom ledger account box
    let observer = new MutationObserver(function() {
        let outing_id = getCurrentEvent();
        let customIncomeLedger = GM_getValue('income_'+outing_id, '');
        $('#event-gnucash-income-ledger-account').val(customIncomeLedger);
        if(customIncomeLedger) {
            console.log('custom income ledger for '+outing_id+' -- '+customIncomeLedger);
        }

        let customExpenseLedger = GM_getValue('expense_'+outing_id, '');
        $('#event-gnucash-expense-ledger-account').val(customExpenseLedger);
        if(customExpenseLedger) {
            console.log('custom expense ledger for '+outing_id+' -- '+customExpenseLedger);
        }
    });

    observer.observe(document.querySelector(VIEW_EVENT), {
        attributes: true
    });

    // remove the edit link on any event payment transactions that came before the last CSV export
    let memberPayObserver = new MutationObserver(function() {
        $(MEMBER_PAY+' .payment-edit').each(function() {
            const clickAttr = $(this).find('a').attr('onclick');
            const match = clickAttr.toString().match(MEMBER_PAY_MATCH);
            const key = match[1];
            const payment_id = match[2]; 
            const outing = getOuting(getCurrentEvent());

            const iPayment = getMemberPaymentIndexByKey( outing, key, payment_id );
            const payment = getMemberPaymentByIndex( outing, key, iPayment );
        
            // if the payment timestamp is before the CSV export timestamp, remove the edit link.
            if(payment.inserted < new Date(tLastCSVExport).getTime()) {
                $(this).html(NO_EDIT_SPAN);
            }
        })
    });

    // this observer fires when the value of the MEMBER_PAY div changes
    memberPayObserver.observe(document.querySelector(MEMBER_PAY), {
        attributes: true
    });

    // make sure all the DOM nodes I need are hanging around...
    try {
        NODES.forEach((node) => {
            if(!$(node).length > 0) {
               throw new Error( 'DOM Node "'+node+'" could not be found.');
            }
        });    
    }
    catch(err) {
        openLightBox( {
            text: 'st_csv: '+err,
            canClose: true,
            size: 'big'} );    
    }

    GM_addStyle(`
    div.tLabel {
        color: black;
        text-shadow: 0 0 0 transparent, rgba(0, 0, 0, .2) 0 1px 1px;
    }

    div.tLabel:hover {
        color: var(--color-heading);
    }
    `);

    // inject the "create CSV report" and "last run" inputs
    $(MONEY_MGMT).siblings().eq(0).append(`
    <li class="arrow">
      <a href="javascript:void(0)" onclick="Window.gnucash.createCSVReport();">
        Create GnuCash Report Document
        <span class="subtext">Downloads a file of recent ${tSection} Wallet activity for import into GnuCash, in .CSV format</span>
      </a>
    </li>
    <li class="input ani-placeholder">
      <div class="tLabel">GnuCash Last Run</div>
      <input type="datetime-local" id="gnucash-last-run" onchange="Window.gnucash.updateLastRun(this.value);" required="" value="${tLastCSVExport}">
    </li>`);

    // inject the Custom Ledger Account input on the event's Edit page, which changes when the event page is changed.
    $(EVENT_DTLS).append(`
    <li class="input ani-placeholder">
      <input type="text" id="event-gnucash-income-ledger-account" onchange="Window.gnucash.updateEventLedger( getCurrentEvent(), 0, this.value );" required="" title="GnuCash Income Ledger Account">
      <label for="event-gnucash-income-ledger-account">GnuCash Income Ledger Account</label>
    </li>
    <li class="input ani-placeholder">
      <input type="text" id="event-gnucash-expense-ledger-account" onchange="Window.gnucash.updateEventLedger( getCurrentEvent(), 1, this.value );" required="" title="GnuCash Expense Ledger Account">
      <label for="event-gnucash-expense-ledger-account">GnuCash Expense Ledger Account</label>
    </li>`);
})();